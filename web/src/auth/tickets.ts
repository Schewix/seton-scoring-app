import { getLocalforage } from '../storage/localforage';
import { canonicalStringify } from './canonical';

export type TicketState = 'waiting' | 'serving' | 'done';

export interface Ticket {
  id: string;
  patrolId: string;
  patrolCode: string;
  teamName: string;
  category: string;
  sex: string;
  state: TicketState;
  createdAt: string;
  arrivedAt?: string;
  servedAt?: string;
  waitStartedAt?: string;
  waitAccumMs: number;
  serveStartedAt?: string;
  serveAccumMs: number;
  points?: number | null;
}

const TICKETS_KEY_PREFIX = 'station_tickets_v1_';

function getTicketsKey(stationId: string) {
  return `${TICKETS_KEY_PREFIX}${stationId}`;
}

type StoredTicket = Ticket & { state?: TicketState | 'paused' };

function sanitizeTicket(raw: StoredTicket): Ticket {
  const state: TicketState = raw.state === 'serving' || raw.state === 'done' ? raw.state : 'waiting';
  const normalizedArrivedAt =
    typeof raw.arrivedAt === 'string' && raw.arrivedAt.length > 0
      ? raw.arrivedAt
      : typeof raw.waitStartedAt === 'string' && raw.waitStartedAt.length > 0
        ? raw.waitStartedAt
        : undefined;
  const normalizedServedAt =
    typeof raw.servedAt === 'string' && raw.servedAt.length > 0 ? raw.servedAt : undefined;
  const points =
    typeof raw.points === 'number' && Number.isFinite(raw.points) ? raw.points : raw.points ?? null;
  return {
    id: raw.id,
    patrolId: raw.patrolId,
    patrolCode: raw.patrolCode,
    teamName: raw.teamName,
    category: raw.category,
    sex: typeof raw.sex === 'string' ? raw.sex : '',
    state,
    createdAt: raw.createdAt,
    arrivedAt: normalizedArrivedAt,
    servedAt: normalizedServedAt,
    waitStartedAt: state === 'waiting' ? raw.waitStartedAt : undefined,
    waitAccumMs: raw.waitAccumMs ?? 0,
    serveStartedAt: undefined,
    serveAccumMs: 0,
    points,
  } satisfies Ticket;
}

export async function loadTickets(stationId: string) {
  const localforage = getLocalforage();
  const list = await localforage.getItem<StoredTicket[]>(getTicketsKey(stationId));
  if (!list) {
    return [];
  }
  return list.map(sanitizeTicket);
}

export async function saveTickets(stationId: string, tickets: Ticket[]) {
  const localforage = getLocalforage();
  if (!tickets.length) {
    await localforage.removeItem(getTicketsKey(stationId));
  } else {
    await localforage.setItem(getTicketsKey(stationId), tickets);
  }
}

export function generateTicketId(patrolId: string) {
  const now = Date.now().toString(16);
  return `${patrolId}-${now}`;
}

export function createTicket(data: {
  patrolId: string;
  patrolCode: string;
  teamName: string;
  category: string;
  sex: string;
  initialState?: TicketState;
}): Ticket {
  const now = new Date().toISOString();
  const state = data.initialState ?? 'waiting';
  return {
    id: generateTicketId(data.patrolId),
    patrolId: data.patrolId,
    patrolCode: data.patrolCode,
    teamName: data.teamName,
    category: data.category,
    sex: data.sex,
    state,
    createdAt: now,
    arrivedAt: state === 'waiting' ? now : undefined,
    servedAt: state === 'serving' ? now : undefined,
    waitStartedAt: state === 'waiting' ? now : undefined,
    waitAccumMs: 0,
    serveStartedAt: undefined,
    serveAccumMs: 0,
    points: null,
  };
}

function toMs(value: string | undefined) {
  if (!value) {
    return null;
  }
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function computeWaitTime(ticket: Ticket) {
  const arrivedMs = toMs(ticket.arrivedAt);
  const servedMs = toMs(ticket.servedAt);
  if (arrivedMs !== null) {
    if (servedMs !== null) {
      return Math.max(0, servedMs - arrivedMs);
    }
    if (ticket.state === 'waiting' || ticket.state === 'serving') {
      return Math.max(0, Date.now() - arrivedMs);
    }
    return 0;
  }

  // Legacy fallback for older stored tickets.
  const base = ticket.waitAccumMs;
  if (ticket.state === 'waiting' && ticket.waitStartedAt) {
    return base + Math.max(0, Date.now() - new Date(ticket.waitStartedAt).getTime());
  }
  return base;
}

export function minutesFromMs(ms: number) {
  return ms / 60000;
}

export function canonicalTicketSignaturePayload(tickets: Ticket[]) {
  return canonicalStringify(
    tickets.map(({ id, state, arrivedAt, servedAt, waitAccumMs, serveAccumMs }) => ({
      id,
      state,
      arrivedAt,
      servedAt,
      waitAccumMs,
      serveAccumMs,
    })),
  );
}

export function transitionTicket(
  ticket: Ticket,
  nextState: TicketState,
  timestamp: number | Date = Date.now(),
): Ticket {
  const nowMs = typeof timestamp === 'number' ? timestamp : timestamp.getTime();
  const nowIso = new Date(nowMs).toISOString();

  const result: Ticket = {
    ...ticket,
    state: nextState,
    waitStartedAt: ticket.waitStartedAt,
    serveStartedAt: undefined,
  };

  switch (nextState) {
    case 'waiting': {
      if (!ticket.arrivedAt) {
        result.arrivedAt = nowIso;
      }
      // Keep UI timer running for waiting column and make "servedAt" overwrite-able.
      result.servedAt = undefined;
      result.waitStartedAt = result.arrivedAt ?? nowIso;
      break;
    }
    case 'serving': {
      if (!ticket.arrivedAt && ticket.state === 'waiting') {
        result.arrivedAt = nowIso;
      }
      // Entering serving always updates "servedAt" so the supervisor can correct timing by requeueing.
      result.servedAt = nowIso;
      result.waitStartedAt = undefined;
      break;
    }
    case 'done': {
      result.waitStartedAt = undefined;
      break;
    }
    default:
      break;
  }

  return result;
}
