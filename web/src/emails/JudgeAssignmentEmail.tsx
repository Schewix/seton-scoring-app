/**
 * Judge Assignment Email Template
 * 
 * Sent when a judge is assigned to:
 * - A board event (Deskové hry module)
 * - Optionally to specific games and/or categories
 * 
 * Subject: "Přístup pro rozhodčího – {eventName}"
 */

import React from 'react';
import { EmailLayout, EmailButton, EmailCard } from './EmailLayout';

export interface JudgeAssignmentEmailProps {
  judgeDisplayName: string;
  eventName: string;
  games?: string[];
  categoryName?: string | null;
  loginUrl: string;
}

export function JudgeAssignmentEmail({
  judgeDisplayName,
  eventName,
  games = [],
  categoryName = null,
  loginUrl,
}: JudgeAssignmentEmailProps) {
  // Build preheader: short summary of assignment
  const preheader = categoryName
    ? `Byl/a jsi přidán/a jako rozhodčí v ${eventName} (${categoryName})`
    : `Byl/a jsi přidán/a jako rozhodčí v ${eventName}`;

  return (
    <EmailLayout preheader={preheader}>
      <p style={{
        margin: '0 0 20px',
        fontSize: '16px',
        color: '#333333',
        lineHeight: '1.5',
      }}>
        Dobrý den <strong>{judgeDisplayName}</strong>,
      </p>

      <p style={{
        margin: '0 0 20px',
        fontSize: '16px',
        color: '#333333',
        lineHeight: '1.5',
      }}>
        Byl/a jste přidán/a jako rozhodčí v systému Zelené ligy pro:
      </p>

      {/* Event details card */}
      <EmailCard title="Přiřazení">
        <p style={{ margin: '0 0 8px' }}>
          <strong>Akce:</strong> {eventName}
        </p>
        {categoryName && (
          <p style={{ margin: '0 0 8px' }}>
            <strong>Kategorie:</strong> {categoryName}
          </p>
        )}
        {games && games.length > 0 && (
          <p style={{ margin: '0' }}>
            <strong>Přiřazené hry:</strong> {games.join(', ')}
          </p>
        )}
      </EmailCard>

      <p style={{
        margin: '20px 0',
        fontSize: '14px',
        color: '#666666',
        lineHeight: '1.5',
      }}>
        Přihlaste se do aplikace a podívejte se na svá přiřazení, budoucí zápasy a další informace:
      </p>

      {/* CTA Button */}
      <div style={{ textAlign: 'center' }}>
        <EmailButton href={loginUrl}>
          Otevřít aplikaci
        </EmailButton>
      </div>

      {/* Fallback link for email clients that don't render buttons */}
      <p style={{
        margin: '0',
        fontSize: '12px',
        color: '#0b63b5',
        textAlign: 'center',
      }}>
        Pokud se vám tlačítko nezobrazilo,{' '}
        <a 
          href={loginUrl}
          style={{ color: '#0b63b5', textDecoration: 'underline' }}
        >
          klikněte sem pro přístup
        </a>
      </p>

      <hr style={{
        margin: '20px 0',
        border: 'none',
        borderTop: '1px solid #e8e8e8',
      }} />

      <p style={{
        margin: '20px 0 0',
        fontSize: '14px',
        color: '#666666',
        lineHeight: '1.5',
      }}>
        <strong>Potřebujete pomoc?</strong> V aplikaci najdete pravidla, pokyny pro rozhodčí a další informace v sekci <em>Pravidla</em>. Máte-li technické dotazy, kontaktujte prosím info@zelenaliga.cz.
      </p>
    </EmailLayout>
  );
}

/**
 * Render email to HTML string (for use with Resend API)
 * 
 * Example usage:
 * const html = renderJudgeAssignmentEmail({
 *   judgeDisplayName: 'Jan Novotný',
 *   eventName: 'Zelená Liga 2026',
 *   games: ['Ubongo', 'Dominion'],
 *   categoryName: 'Kategorie III + IV',
 *   loginUrl: 'https://zelenaliga.cz/prihlaseni',
 * });
 * 
 * // Send with Resend:
 * await resend.emails.send({
 *   from: 'Zelená Liga <noreply@zelenaliga.cz>',
 *   to: judgeEmail,
 *   subject: `Přístup pro rozhodčího – Zelená Liga 2026`,
 *   html,
 * });
 */
export function renderJudgeAssignmentEmail(props: JudgeAssignmentEmailProps): string {
  // Note: This is a simplified render function for server-side use.
  // In a real scenario with React Email library, you'd use @react-email/render
  // For now, we serialize the component to HTML using JSX-to-string or renderToStaticMarkup
  
  const ReactDOMServer = require('react-dom/server');
  return ReactDOMServer.renderToStaticMarkup(
    <JudgeAssignmentEmail {...props} />
  );
}
