/**
 * Shared email layout component for Zelená Liga
 * 
 * Color scheme:
 * - Primary green: #0b8e3f (used in header gradient)
 * - Accent green dark: #06642b
 * - Primary yellow: #ffd700 (CTAs)
 * - Light background: #f7fbff
 * 
 * This component provides consistent structure for all transactional emails.
 * To customize branding, edit the colors in the inline styles below.
 */

import React, { ReactNode } from 'react';

interface EmailLayoutProps {
  children: ReactNode;
  preheader: string;
}

export function EmailLayout({ children, preheader }: EmailLayoutProps) {
  return (
    <html lang="cs">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Zelená liga</title>
        {/* Preheader text (visible in email preview) */}
        <style dangerouslySetInnerHTML={{
          __html: `.preheader { display: none !important; visibility: hidden !important; mso-hide: all !important; font-size: 1px !important; line-height: 1px !important; max-height: 0px !important; max-width: 0px !important; opacity: 0 !important; overflow: hidden !important; }`,
        }} />
      </head>
      <body style={{ 
        margin: 0, 
        padding: 0, 
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        backgroundColor: '#f5f5f5',
        minHeight: '100vh',
      }}>
        {/* Preheader text */}
        <div className="preheader">{preheader}</div>

        {/* Container */}
        <table 
          width="100%" 
          cellPadding="0" 
          cellSpacing="0" 
          style={{ backgroundColor: '#f5f5f5' }}
        >
          <tbody>
            <tr>
              <td align="center" style={{ paddingTop: '20px', paddingBottom: '20px' }}>
                <table
                  width="100%"
                  cellPadding="0"
                  cellSpacing="0"
                  style={{
                    width: '100%',
                    maxWidth: '600px',
                    backgroundColor: '#ffffff',
                    borderRadius: '8px',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                  }}
                >
                  <tbody>
                    {/* Header with gradient */}
                    <tr>
                      <td
                        style={{
                          background: 'linear-gradient(135deg, #0b8e3f 0%, #06642b 100%)',
                          padding: '32px 24px',
                          textAlign: 'center',
                          color: '#ffffff',
                          borderRadius: '8px 8px 0 0',
                        }}
                      >
                        <h1 style={{
                          margin: '0',
                          fontSize: '28px',
                          fontWeight: '700',
                          color: '#ffffff',
                        }}>
                          Zelená Liga
                        </h1>
                        <p style={{
                          margin: '8px 0 0',
                          fontSize: '14px',
                          color: 'rgba(255, 255, 255, 0.9)',
                          fontWeight: '500',
                        }}>
                          SPTO Brno
                        </p>
                      </td>
                    </tr>

                    {/* Main content */}
                    <tr>
                      <td style={{ padding: '28px 28px' }}>
                        {children}
                      </td>
                    </tr>

                    {/* Footer */}
                    <tr>
                      <td
                        style={{
                          borderTop: '1px solid #e8e8e8',
                          padding: '20px 28px',
                          backgroundColor: '#f9f9f9',
                          borderRadius: '0 0 8px 8px',
                          fontSize: '12px',
                          color: '#666666',
                          lineHeight: '1.6',
                        }}
                      >
                        <p style={{ margin: '0 0 8px' }}>
                          <strong>Proč jste obdrželi tento e-mail?</strong><br />
                          Byl/a jste přidán/a jako rozhodčí v systému Zelené ligy.
                        </p>
                        <p style={{ margin: '8px 0' }}>
                          <strong>Projekt:</strong> Zelená liga SPTO • Brno
                        </p>
                        <p style={{ margin: '8px 0 0' }}>
                          Máte-li otázky, kontaktujte prosím organizátory na{' '}
                          <a 
                            href="mailto:info@zelenaliga.cz" 
                            style={{ color: '#0b8e3f', textDecoration: 'underline' }}
                          >
                            info@zelenaliga.cz
                          </a>
                        </p>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}

/**
 * Responsive button component for emails
 * Uses yellow (#ffd700) as primary CTA color
 */
export function EmailButton({ 
  href, 
  children 
}: { 
  href: string; 
  children: ReactNode 
}) {
  return (
    <table
      cellPadding="0"
      cellSpacing="0"
      style={{
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        marginTop: '20px',
        marginBottom: '20px',
      }}
    >
      <tbody>
        <tr>
          <td
            align="center"
            style={{
              backgroundColor: '#ffd700',
              padding: '14px 32px',
              borderRadius: '6px',
              textAlign: 'center',
            }}
          >
            <a
              href={href}
              style={{
                color: '#000000',
                textDecoration: 'none',
                fontSize: '16px',
                fontWeight: '600',
                display: 'inline-block',
              }}
            >
              {children}
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/**
 * Card component for displaying details (event, game, role info)
 */
export function EmailCard({ 
  title, 
  children 
}: { 
  title: string; 
  children: ReactNode 
}) {
  return (
    <table
      width="100%"
      cellPadding="0"
      cellSpacing="0"
      style={{
        backgroundColor: '#f7fbff',
        border: '1px solid #d4e5f7',
        borderRadius: '6px',
        marginTop: '16px',
        marginBottom: '16px',
      }}
    >
      <tbody>
        <tr>
          <td style={{ padding: '16px' }}>
            <h3 style={{
              margin: '0 0 12px',
              fontSize: '14px',
              fontWeight: '600',
              color: '#06642b',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              {title}
            </h3>
            <div style={{ fontSize: '14px', color: '#333333', lineHeight: '1.6' }}>
              {children}
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
