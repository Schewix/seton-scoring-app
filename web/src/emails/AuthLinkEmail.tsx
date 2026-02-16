/**
 * Authentication Link Email Template
 * 
 * Used for:
 * - Password reset emails
 * - Passwordless login (magic link)
 * - One-time authentication links
 * 
 * Subject: "Přihlášení do Zelené ligy" or "Resetovat heslo"
 */

import React from 'react';
import { EmailLayout, EmailButton, EmailCard } from './EmailLayout';

export interface AuthLinkEmailProps {
 recipientName?: string;
 magicLink: string;
 expiresInMinutes?: number;
 isPasswordReset?: boolean;
}

export function AuthLinkEmail({
 recipientName,
 magicLink,
 expiresInMinutes = 60,
 isPasswordReset = false,
}: AuthLinkEmailProps) {
 const isReset = isPasswordReset;

 const preheader = isReset
  ? 'Resetujte své heslo pomocí tohoto odkazu'
  : 'Váš odkaz pro přihlášení do aplikace Zelené ligy';

 const subject = isReset ? 'Resetovat heslo' : 'Přihlášení do Zelené ligy';
 const greeting = isReset ? 'Resetování hesla' : 'Přihlášení';
 const explanation = isReset
  ? 'Obdrželi jste tento e-mail, protože jste požádali o resetování hesla do aplikace Zelené ligy. Pokud jste to nebyli vy, můžete bezpečně ignorovat tento e-mail.'
  : 'Obdrželi jste tento e-mail, protože jste se pokusili přihlásit bez hesla. Kliknutím na odkaz níže se automaticky přihlásíte.';

 const buttonText = isReset ? 'Resetovat heslo' : 'Přihlásit se';

 return (
  <EmailLayout preheader={preheader}>
   <p style={{
    margin: '0 0 20px',
    fontSize: '16px',
    color: '#333333',
    lineHeight: '1.5',
   }}>
    Dobrý den{recipientName ? ` ${recipientName}` : ''},
   </p>

   <p style={{
    margin: '0 0 20px',
    fontSize: '16px',
    color: '#333333',
    lineHeight: '1.5',
   }}>
    {explanation}
   </p>

   {/* Security info card */}
   <EmailCard title={greeting}>
    <p style={{ margin: '0' }}>
     <strong>Platnost odkazu:</strong> {expiresInMinutes} minut
    </p>
    {isReset && (
     <p style={{ margin: '8px 0 0' }}>
      <strong>Akce:</strong> Resetování hesla
     </p>
    )}
   </EmailCard>

   <p style={{
    margin: '20px 0',
    fontSize: '14px',
    color: '#666666',
    lineHeight: '1.5',
    textAlign: 'center',
   }}>
    Klikněte na tlačítko níže pro {isReset ? 'resetování hesla' : 'přihlášení'}:
   </p>

   {/* CTA Button */}
   <div style={{ textAlign: 'center' }}>
    <EmailButton href={magicLink}>
     {buttonText}
    </EmailButton>
   </div>

   {/* Fallback link */}
   <p style={{
    margin: '0',
    fontSize: '12px',
    color: '#0b8e3f',
    textAlign: 'center',
   }}>
    Pokud se vám tlačítko nezobrazilo,{' '}
    <a
     href={magicLink}
     style={{ color: '#0b8e3f', textDecoration: 'underline' }}
    >
     klikněte sem
    </a>
   </p>

   {/* Security notice */}
   <div style={{
    margin: '20px 0 0',
    padding: '12px',
    backgroundColor: '#f0f4ff',
    border: '1px solid #d4e5f7',
    borderRadius: '4px',
    fontSize: '12px',
    color: '#555555',
    lineHeight: '1.4',
   }}>
    <strong style={{ color: '#06642b' }}>⚠️ Bezpečnostní tip:</strong> Pokud jste tento e-mail neodeslali, zkontrolujte si bezpečnost svého účtu. Nevěřte nikomu, kdo vám posílá odkazy na přihlášení e-mailem.
   </div>

   <hr style={{
    margin: '20px 0',
    border: 'none',
    borderTop: '1px solid #e8e8e8',
   }} />

   <p style={{
    margin: '20px 0 0',
    fontSize: '12px',
    color: '#999999',
    lineHeight: '1.5',
   }}>
    Máte-li problémy s přihlášením, kontaktujte prosím info@zelenaliga.cz.
   </p>
  </EmailLayout>
 );
}

/**
 * Render email to HTML string (for use with Resend API)
 * 
 * Example usage - Password Reset:
 * const html = renderAuthLinkEmail({
 *   recipientName: 'Jana Součková',
 *   magicLink: 'https://zelenaliga.cz/auth/reset-password?token=abc123',
 *   expiresInMinutes: 60,
 *   isPasswordReset: true,
 * });
 * 
 * Example usage - Passwordless Login:
 * const html = renderAuthLinkEmail({
 *   recipientName: 'Jan Novotný',
 *   magicLink: 'https://zelenaliga.cz/auth/login?token=xyz789',
 *   expiresInMinutes: 30,
 *   isPasswordReset: false,
 * });
 * 
 * // Send with Resend:
 * await resend.emails.send({
 *   from: 'Zelená Liga <noreply@zelenaliga.cz>',
 *   to: userEmail,
 *   subject: isPasswordReset ? 'Resetovat heslo' : 'Přihlášení do Zelené ligy',
 *   html,
 * });
 */
export function renderAuthLinkEmail(props: AuthLinkEmailProps): string {
 // Note: This is a simplified render function for server-side use.
 // In a real scenario with React Email library, you'd use @react-email/render
 // For now, we serialize the component to HTML using JSX-to-string or renderToStaticMarkup

 const ReactDOMServer = require('react-dom/server');
 return ReactDOMServer.renderToStaticMarkup(
  <AuthLinkEmail {...props} />
 );
}
