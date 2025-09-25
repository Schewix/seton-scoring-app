import { useMemo } from 'react';
import type { Ticket } from '../auth/tickets';

interface TicketQueueProps {
  tickets: Ticket[];
  onChangeState: (id: string, nextState: Ticket['state']) => void;
  onReset: () => void;
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function slaClass(ms: number) {
  const minutes = ms / 60000;
  if (minutes >= 10) return 'ticket-critical';
  if (minutes >= 5) return 'ticket-warning';
  return 'ticket-ok';
}

export default function TicketQueue({ tickets, onChangeState, onReset }: TicketQueueProps) {
  const grouped = useMemo(() => {
    const waiting: Ticket[] = [];
    const serving: Ticket[] = [];
    const done: Ticket[] = [];
    const paused: Ticket[] = [];

    tickets.forEach((ticket) => {
      switch (ticket.state) {
        case 'waiting':
          waiting.push(ticket);
          break;
        case 'serving':
          serving.push(ticket);
          break;
        case 'paused':
          paused.push(ticket);
          break;
        case 'done':
          done.push(ticket);
          break;
        default:
          break;
      }
    });

    return { waiting, serving, done, paused };
  }, [tickets]);

  const nextUp = grouped.waiting[0];

  return (
    <section className="card tickets-card">
      <header className="card-header">
        <div>
          <h2>Fronta hlídek</h2>
          <p className="card-subtitle">
            čekání / obsluha hlídky, stav se počítá z časových značek (zvládne offline i restart).
          </p>
        </div>
        <div className="card-actions">
          <button type="button" className="ghost" onClick={onReset}>
            Resetovat frontu
          </button>
        </div>
      </header>

      <div className="tickets-grid">
        <div className="tickets-column">
          <div className="tickets-column-header">
            <h3>Waiting</h3>
            <span>{grouped.waiting.length}</span>
          </div>
          <ul>
            {grouped.waiting.map((ticket) => (
              <li key={ticket.id} className={`ticket ${slaClass(ticket.waitAccumMs)}`}>
                <div>
                  <strong>{ticket.patrolCode}</strong>
                  <span>{ticket.teamName}</span>
                </div>
                <div className="ticket-meta">
                  <span>{formatDuration(ticket.waitAccumMs)}</span>
                  <button type="button" onClick={() => onChangeState(ticket.id, 'serving')}>
                    Obsluhovat
                  </button>
                  <button type="button" onClick={() => onChangeState(ticket.id, 'paused')}>
                    Pozastavit
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="tickets-column">
          <div className="tickets-column-header">
            <h3>Serving</h3>
            <span>{grouped.serving.length}</span>
          </div>
          <ul>
            {grouped.serving.map((ticket) => (
              <li key={ticket.id} className="ticket ticket-serving">
                <div>
                  <strong>{ticket.patrolCode}</strong>
                  <span>{ticket.teamName}</span>
                </div>
                <div className="ticket-meta">
                  <span>{formatDuration(ticket.serveAccumMs)}</span>
                  <button type="button" onClick={() => onChangeState(ticket.id, 'done')}>
                    Hotovo
                  </button>
                  <button type="button" onClick={() => onChangeState(ticket.id, 'paused')}>
                    Pozastavit
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="tickets-column">
          <div className="tickets-column-header">
            <h3>Paused</h3>
            <span>{grouped.paused.length}</span>
          </div>
          <ul>
            {grouped.paused.map((ticket) => (
              <li key={ticket.id} className="ticket ticket-paused">
                <div>
                  <strong>{ticket.patrolCode}</strong>
                  <span>{ticket.teamName}</span>
                </div>
                <div className="ticket-meta">
                  <span>{formatDuration(ticket.waitAccumMs)}</span>
                  <button type="button" onClick={() => onChangeState(ticket.id, 'waiting')}>
                    Čeká dál
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="tickets-column">
          <div className="tickets-column-header">
            <h3>Done</h3>
            <span>{grouped.done.length}</span>
          </div>
          <ul>
            {grouped.done.map((ticket) => (
              <li key={ticket.id} className="ticket ticket-done">
                <div>
                  <strong>{ticket.patrolCode}</strong>
                  <span>{ticket.teamName}</span>
                </div>
                <div className="ticket-meta">
                  <span>{formatDuration(ticket.serveAccumMs)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {nextUp ? (
        <div className="tickets-next">
          <strong>Next up:</strong> {nextUp.patrolCode} • {nextUp.teamName}
        </div>
      ) : null}
    </section>
  );
}
