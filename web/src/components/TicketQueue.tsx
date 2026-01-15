import { forwardRef, useMemo, useState } from 'react';
import type { Ticket } from '../auth/tickets';
import { computeWaitTime } from '../auth/tickets';

interface TicketQueueProps {
  tickets: Ticket[];
  onChangeState: (id: string, nextState: Ticket['state']) => void;
  heartbeat: number;
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatPoints(points?: number | null) {
  if (typeof points !== 'number' || !Number.isFinite(points)) {
    return '—';
  }
  return `${points.toFixed(2)}b`;
}

function slaClass(ms: number) {
  const minutes = ms / 60000;
  if (minutes >= 10) return 'ticket-critical';
  if (minutes >= 5) return 'ticket-warning';
  return 'ticket-ok';
}

const TicketQueue = forwardRef<HTMLElement, TicketQueueProps>(function TicketQueue(
  { tickets, onChangeState, heartbeat }: TicketQueueProps,
  ref,
) {
  const grouped = useMemo(() => {
    const waiting: Ticket[] = [];
    const serving: Ticket[] = [];
    const done: Ticket[] = [];

    tickets.forEach((ticket) => {
      switch (ticket.state) {
        case 'waiting':
          waiting.push(ticket);
          break;
        case 'serving':
          serving.push(ticket);
          break;
        case 'done':
          done.push(ticket);
          break;
        default:
          break;
      }
    });

    return { waiting, serving, done };
  }, [tickets, heartbeat]);

  const nextUp = grouped.waiting[0];
  const [showDone, setShowDone] = useState(true);

  return (
    <section ref={ref} className="card tickets-card">
      <header className="card-header">
        <div>
          <h2>Fronta hlídek</h2>
          <p className="card-subtitle">
            čekání / obsluha hlídky, stav se počítá z časových značek (zvládne offline i restart).
          </p>
        </div>
        <div className="card-actions">
          <button type="button" className="ghost" onClick={() => setShowDone((current) => !current)}>
            {showDone ? 'Skrýt hotové' : 'Zobrazit hotové'}
          </button>
        </div>
      </header>

      <div className="tickets-grid">
        <div className="tickets-column">
          <div className="tickets-column-header">
            <h3>Čekají</h3>
            <span>{grouped.waiting.length}</span>
          </div>
          <ul>
            {grouped.waiting.map((ticket) => {
              const waitMs = computeWaitTime(ticket);
              return (
                <li key={ticket.id} className={`ticket ${slaClass(waitMs)}`}>
                  <div>
                    <strong>{ticket.patrolCode}</strong>
                    <span>{ticket.teamName}</span>
                  </div>
                  <div className="ticket-meta">
                    <span>{formatDuration(waitMs)}</span>
                    <div className="ticket-actions">
                      <button type="button" onClick={() => onChangeState(ticket.id, 'serving')}>
                        Obsluhovat
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="tickets-column">
          <div className="tickets-column-header">
            <h3>Obsluhované</h3>
            <span>{grouped.serving.length}</span>
          </div>
          <ul>
            {grouped.serving.map((ticket) => {
              const waitMs = computeWaitTime(ticket);
              return (
                <li key={ticket.id} className="ticket ticket-serving">
                  <div>
                    <strong>{ticket.patrolCode}</strong>
                    <span>{ticket.teamName}</span>
                  </div>
                  <div className="ticket-meta">
                    <span>{waitMs > 0 ? formatDuration(waitMs) : '—'}</span>
                    <div className="ticket-actions">
                      <button type="button" onClick={() => onChangeState(ticket.id, 'done')}>
                        Hotovo
                      </button>
                      <button type="button" onClick={() => onChangeState(ticket.id, 'waiting')}>
                        Čekat
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        {showDone ? (
          <div className="tickets-column">
            <div className="tickets-column-header">
              <h3>Hotové</h3>
              <span>{grouped.done.length}</span>
            </div>
            <ul>
              {grouped.done.map((ticket) => {
                const waitMs = computeWaitTime(ticket);
                const waitLabel = waitMs > 0 ? formatDuration(waitMs) : '—';
                const pointsLabel = formatPoints(ticket.points);
                return (
                  <li key={ticket.id} className="ticket ticket-done">
                    <div>
                      <strong>{ticket.patrolCode}</strong>
                      <span>{ticket.teamName}</span>
                    </div>
                    <div className="ticket-meta">
                      <span>{`${waitLabel} | ${pointsLabel}`}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>

      {nextUp ? (
        <div className="tickets-next">
          <strong>Další v pořadí:</strong> {nextUp.patrolCode} • {nextUp.teamName}
        </div>
      ) : null}
    </section>
  );
});

export default TicketQueue;
