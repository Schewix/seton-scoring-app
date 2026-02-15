/**
 * Email Rendering Utility
 * 
 * Converts React email components to HTML strings for sending via Resend API
 * Compatible with both Node.js (web/api) and Deno (supabase/functions)
 */

import React from 'react';

/**
 * Render a React component to static HTML string
 * Works in both Node.js and Deno environments
 * 
 * @param component - React component to render
 * @param props - Props to pass to the component
 * @returns HTML string ready for email sending
 */
export function renderEmailToHtml<T extends Record<string, any>>(
  component: React.ComponentType<T>,
  props: T
): string {
  try {
    // Try Node.js environment (web/api context)
    const ReactDOMServer = require('react-dom/server');
    return ReactDOMServer.renderToStaticMarkup(
      React.createElement(component, props)
    );
  } catch (nodeError) {
    try {
      // Fallback: Try simple JSX serialization for Deno
      // This is a basic implementation - for production, consider using
      // a library like @react-email/render or preact-render-to-string
      const element = React.createElement(component, props);
      return serializeElement(element);
    } catch (fallbackError) {
      console.error('Email rendering failed:', fallbackError);
      throw new Error(
        `Failed to render email template. Error: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
      );
    }
  }
}

/**
 * Basic JSX element serializer for environments without ReactDOMServer
 * Recursively converts React elements to HTML strings
 */
function serializeElement(element: any): string {
  // Handle null, undefined, boolean
  if (!element || typeof element === 'boolean') {
    return '';
  }

  // Handle strings and numbers
  if (typeof element === 'string' || typeof element === 'number') {
    return escapeHtml(String(element));
  }

  // Handle arrays (fragments, children arrays)
  if (Array.isArray(element)) {
    return element.map(serializeElement).join('');
  }

  // Handle React elements
  if (element && typeof element === 'object' && element.type) {
    const { type, props: elementProps } = element;

    // Handle function components
    if (typeof type === 'function') {
      const instance = type(elementProps);
      return serializeElement(instance);
    }

    // Handle string elements (HTML tags)
    if (typeof type === 'string') {
      const { children, ...attrs } = elementProps || {};
      const attrString = Object.entries(attrs)
        .map(([key, value]) => {
          // Skip React-specific props and event handlers
          if (
            key.startsWith('on') ||
            key === 'key' ||
            key === 'ref' ||
            value === undefined ||
            value === null
          ) {
            return '';
          }

          // Convert camelCase to kebab-case for style and data attributes
          const attrKey = key === 'className' ? 'class' : key;
          
          // Handle style object
          if (key === 'style' && typeof value === 'object') {
            const styleString = Object.entries(value as Record<string, any>)
              .map(([k, v]) => {
                const cssKey = k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
                return `${cssKey}:${v}`;
              })
              .join(';');
            return styleString ? `style="${styleString}"` : '';
          }

          // Handle dangerouslySetInnerHTML (not recommended, but supported)
          if (key === 'dangerouslySetInnerHTML' && typeof value === 'object') {
            return '';
          }

          const encodedValue = String(value)
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
          return `${attrKey}="${encodedValue}"`;
        })
        .filter(Boolean)
        .join(' ');

      const attrPart = attrString ? ` ${attrString}` : '';
      const childrenHtml = children ? serializeElement(children) : '';

      // Self-closing tags
      if (['img', 'br', 'hr', 'input', 'meta', 'link'].includes(type)) {
        return `<${type}${attrPart} />`;
      }

      return `<${type}${attrPart}>${childrenHtml}</${type}>`;
    }
  }

  return '';
}

/**
 * HTML escape function to prevent XSS in email content
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * Email sending helper for Resend API
 * 
 * Usage:
 * const html = renderEmailToHtml(JudgeAssignmentEmail, {
 *   judgeDisplayName: 'Jan Novotný',
 *   eventName: 'Zelená Liga 2026',
 *   loginUrl: 'https://zelenaliga.cz/prihlaseni',
 * });
 * 
 * const result = await sendEmail({
 *   to: 'judge@example.com',
 *   subject: 'Přístup pro rozhodčího',
 *   html,
 * });
 */
export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
}

export async function sendEmail(options: EmailOptions): Promise<{ id: string }> {
  const {
    to,
    subject,
    html,
    from = 'Zelená Liga <noreply@zelenaliga.cz>',
    replyTo = 'info@zelenaliga.cz',
  } = options;

  const apiKey = process.env.RESEND_API_KEY || (globalThis as any).Deno?.env?.get?.('RESEND_API_KEY');

  if (!apiKey) {
    throw new Error('RESEND_API_KEY environment variable is not set');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      reply_to: replyTo,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Resend API error: ${error.message || response.statusText}`);
  }

  return response.json();
}
