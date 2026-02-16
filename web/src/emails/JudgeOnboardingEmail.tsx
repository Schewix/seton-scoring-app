/**
 * Judge Onboarding Email Template
 * 
 * Sent when a judge's account is created in the Zelená Liga system.
 * Allows the judge to set up their account and access all sports/modules
 * they have been assigned to.
 * 
 * Subject: "Váš nový účet v Zelené lize"
 */

import React from 'react';
import { EmailLayout, EmailButton, EmailCard } from './EmailLayout';

export interface JudgeAssignmentEmailProps {
  judgeDisplayName: string;
  setupUrl: string; // URL to set up account/password
  tempPassword?: string; // Optional: temporary password if provided
}

export function JudgeAssignmentEmail({
  judgeDisplayName,
  setupUrl,
  tempPassword,
}: JudgeAssignmentEmailProps) {
  // Build preheader: account creation message
  const preheader = 'Váš nový účet v Zelené lize je připraven – nastavte si heslo';

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
        Byl/a jste přidán/a do systému Zelené ligy jako rozhodčí. Váš účet je nyní připraven k použití.
      </p>

      {/* Account setup card */}
      <EmailCard title="Nastavení účtu">
        <p style={{ margin: '0 0 8px' }}>
          Klikněte na tlačítko níže a nastavte si svůj přístupový kód (heslo):
        </p>
        {tempPassword && (
          <p style={{
            margin: '12px 0 0',
            padding: '12px',
            backgroundColor: '#f5f5f5',
            borderRadius: '4px',
            fontFamily: 'monospace',
            fontSize: '12px',
          }}>
            <strong>Dočasný přístupový kód:</strong><br />
            <code style={{ fontSize: '13px', fontWeight: 'bold' }}>{tempPassword}</code>
          </p>
        )}
      </EmailCard>

      <p style={{
        margin: '20px 0',
        fontSize: '14px',
        color: '#666666',
        lineHeight: '1.5',
      }}>
        Jakmile nastavíte svůj účet, budete mít přístup ke všem akcím a modulům, na které jste přiřazeni:
      </p>

      <ul style={{
        margin: '12px 0 20px',
        paddingLeft: '20px',
        fontSize: '14px',
        color: '#666666',
        lineHeight: '1.6',
      }}>
        <li>Deskové hry</li>
        <li>Fotbal</li>
        <li>Běh</li>
        <li>Plavaní</li>
        <li>A další sporty...</li>
      </ul>

      {/* CTA Button */}
      <div style={{ textAlign: 'center' }}>
        <EmailButton href={setupUrl}>
          Nastavit účet
        </EmailButton>
      </div>

      {/* Fallback link for email clients that don't render buttons */}
      <p style={{
        margin: '0',
        fontSize: '12px',
        color: '#0b8e3f',
        textAlign: 'center',
      }}>
        Pokud se vám tlačítko nezobrazilo,{' '}
        <a
          href={setupUrl}
          style={{ color: '#0b8e3f', textDecoration: 'underline' }}
        >
          klikněte sem pro nastavení účtu
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
        <strong>Potřebujete pomoc?</strong> V aplikaci najdete pravidla a pokyny pro rozhodčí v sekci <em>Dokumentace</em>. Máte-li technické dotazy, kontaktujte prosím info@zelenaliga.cz.
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
 *   setupUrl: 'https://zelenaliga.cz/auth/setup-judge?token=abc123',
 *   tempPassword: 'TempPass123!',
 * });
 * 
 * // Send with Resend:
 * await resend.emails.send({
 *   from: 'Zelená Liga <noreply@zelenaliga.cz>',
 *   to: judgeEmail,
 *   subject: 'Váš nový účet v Zelené lize',
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
