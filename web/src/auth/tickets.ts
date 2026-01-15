import localforage from 'localforage';
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
  const waitStartedAt = state === 'waiting' ? raw.waitStartedAt : undefined;
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
    waitStartedAt,
    waitAccumMs: raw.waitAccumMs ?? 0,
    serveStartedAt: undefined,
    serveAccumMs: 0,
    points,
  } satisfies Ticket;
}

export async function loadTickets(stationId: string) {
  const list = await localforage.getItem<StoredTicket[]>(getTicketsKey(stationId));
  if (!list) {
    return [];
  }
  return list.map(sanitizeTicket);
}

export async function saveTickets(stationId: string, tickets: Ticket[]) {
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
    waitStartedAt: state === 'waiting' ? now : undefined,
    waitAccumMs: 0,
    serveStartedAt: undefined,
    serveAccumMs: 0,
    points: null,
  };
}

export function computeWaitTime(ticket: Ticket) {
  const base = ticket.waitAccumMs;
  if (ticket.state === 'waiting' && ticket.waitStartedAt) {
    return base + (Date.now() - new Date(ticket.waitStartedAt).getTime());
  }
  return base;
}

export function minutesFromMs(ms: number) {
  return ms / 60000;
}

export function canonicalTicketSignaturePayload(tickets: Ticket[]) {
  return canonicalStringify(
    tickets.map(({ id, state, waitAccumMs, serveAccumMs }) => ({ id, state, waitAccumMs, serveAccumMs })),
  );
}

function toTimestamp(value: string | undefined) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function transitionTicket(
  ticket: Ticket,
  nextState: TicketState,
  timestamp: number | Date = Date.now(),
): Ticket {
  const nowMs = typeof timestamp === 'number' ? timestamp : timestamp.getTime();
  const nowIso = new Date(nowMs).toISOString();
  let waitAccum = ticket.waitAccumMs;

  const result: Ticket = {
    ...ticket,
    state: nextState,
    waitAccumMs: waitAccum,
    waitStartedAt: ticket.waitStartedAt,
    serveStartedAt: ticket.serveStartedAt,
  };

  const flushWait = () => {
    const startedMs = toTimestamp(ticket.waitStartedAt);
    if (startedMs !== null) {
      waitAccum += Math.max(0, nowMs - startedMs);
      result.waitAccumMs = waitAccum;
    }
    result.waitStartedAt = undefined;
  };

  switch (nextState) {
    case 'waiting': {
      if (ticket.state !== 'waiting') {
        result.waitStartedAt = nowIso;
      } else {
        result.waitStartedAt = ticket.waitStartedAt ?? nowIso;
      }
      break;
    }
    case 'serving': {
      if (ticket.state === 'waiting') {
        const startedMs = toTimestamp(ticket.waitStartedAt);
        if (startedMs !== null) {
          waitAccum += Math.max(0, nowMs - startedMs);
          result.waitAccumMs = waitAccum;
        }
      }
      result.waitStartedAt = undefined;
      result.serveStartedAt = undefined;
      break;
    }
    case 'done': {
      if (ticket.state === 'waiting') {
        flushWait();
      }
      result.waitStartedAt = undefined;
      result.serveStartedAt = undefined;
      break;
    }
    default:
      break;
  }

  return result;
}
