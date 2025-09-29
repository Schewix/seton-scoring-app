import localforage from 'localforage';
import { canonicalStringify } from './canonical';

export type TicketState = 'waiting' | 'paused' | 'serving' | 'done';

export interface Ticket {
  id: string;
  patrolId: string;
  patrolCode: string;
  teamName: string;
  category: string;
  state: TicketState;
  createdAt: string;
  waitStartedAt?: string;
  waitAccumMs: number;
  serveStartedAt?: string;
  serveAccumMs: number;
}

const TICKETS_KEY_PREFIX = 'station_tickets_v1_';

function getTicketsKey(stationId: string) {
  return `${TICKETS_KEY_PREFIX}${stationId}`;
}

export async function loadTickets(stationId: string) {
  const list = await localforage.getItem<Ticket[]>(getTicketsKey(stationId));
  return list ?? [];
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
}): Ticket {
  return {
    id: generateTicketId(data.patrolId),
    patrolId: data.patrolId,
    patrolCode: data.patrolCode,
    teamName: data.teamName,
    category: data.category,
    state: 'waiting',
    createdAt: new Date().toISOString(),
    waitStartedAt: new Date().toISOString(),
    waitAccumMs: 0,
    serveAccumMs: 0,
  };
}

export function computeWaitTime(ticket: Ticket) {
  const base = ticket.waitAccumMs;
  if (ticket.state === 'waiting' && ticket.waitStartedAt) {
    return base + (Date.now() - new Date(ticket.waitStartedAt).getTime());
  }
  return base;
}

export function computeServeTime(ticket: Ticket) {
  const base = ticket.serveAccumMs;
  if (ticket.state === 'serving' && ticket.serveStartedAt) {
    return base + (Date.now() - new Date(ticket.serveStartedAt).getTime());
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
  let serveAccum = ticket.serveAccumMs;

  const result: Ticket = {
    ...ticket,
    state: nextState,
    waitAccumMs: waitAccum,
    serveAccumMs: serveAccum,
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

  const flushServe = () => {
    const startedMs = toTimestamp(ticket.serveStartedAt);
    if (startedMs !== null) {
      serveAccum += Math.max(0, nowMs - startedMs);
      result.serveAccumMs = serveAccum;
    }
    result.serveStartedAt = undefined;
  };

  switch (nextState) {
    case 'waiting': {
      if (ticket.state === 'serving') {
        flushServe();
      }
      if (ticket.state !== 'waiting') {
        result.waitStartedAt = nowIso;
      } else {
        result.waitStartedAt = ticket.waitStartedAt ?? nowIso;
      }
      result.serveStartedAt = undefined;
      break;
    }
    case 'serving': {
      if (ticket.state === 'waiting' || ticket.state === 'paused') {
        const startedMs = toTimestamp(ticket.waitStartedAt);
        if (startedMs !== null) {
          waitAccum += Math.max(0, nowMs - startedMs);
          result.waitAccumMs = waitAccum;
        }
      }
      result.waitStartedAt = undefined;
      if (ticket.state === 'serving' && ticket.serveStartedAt) {
        result.serveStartedAt = ticket.serveStartedAt;
      } else {
        result.serveStartedAt = nowIso;
      }
      break;
    }
    case 'paused': {
      if (ticket.state === 'waiting') {
        flushWait();
      } else {
        result.waitStartedAt = undefined;
      }
      if (ticket.state === 'serving') {
        flushServe();
      } else {
        result.serveStartedAt = undefined;
      }
      break;
    }
    case 'done': {
      if (ticket.state === 'waiting') {
        flushWait();
      }
      if (ticket.state === 'serving') {
        flushServe();
      } else {
        result.serveStartedAt = undefined;
      }
      result.waitStartedAt = undefined;
      break;
    }
    default:
      break;
  }

  return result;
}
