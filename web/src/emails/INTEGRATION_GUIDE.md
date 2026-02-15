# Email Template Integration Guide

## Overview

This guide explains how to integrate the new professional email templates into the existing email sending functions in the Zelená Liga application.

## Templates Created

### 1. **JudgeAssignmentEmail** (`web/src/emails/JudgeAssignmentEmail.tsx`)
Sends when a judge is assigned to an event, optionally with specific games and/or categories.

**Props:**
- `judgeDisplayName` (string) - Judge's display name
- `eventName` (string) - Event name  
- `games` (string[]) - Optional: List of assigned games
- `categoryName` (string | null) - Optional: Assigned category
- `loginUrl` (string) - URL to the login page

**Example:**
# Email Template Integration Guide

## Overview

This guide explains how to integrate the new professional email templates into the existing email sending functions in the Zelená Liga application.

## Templates Created

### 1. **JudgeAssignmentEmail** (`web/src/emails/JudgeAssignmentEmail.tsx`)
Sends when a judge is assigned to an event, optionally with specific games and/or categories.

**Props:**
- `judgeDisplayName` (string) - Judge's display name
- `eventName` (string) - Event name  
- `games` (string[]) - Optional: List of assigned games
- `categoryName` (string | null) - Optional: Assigned category
- `loginUrl` (string) - URL to the login page

**Example:**
```typescript
import { renderEmailToHtml } from '@/emails';
import JudgeAssignmentEmail from '@/emails/JudgeAssignmentEmail';

const html = renderEmailToHtml(JudgeAssignmentEmail, {
  judgeDisplayName: 'Jan Novotný',
  eventName: 'Zelená Liga 2026',
  games: ['Ubongo', 'Dominion'],
  categoryName: 'Kategorie III + IV',
  loginUrl: 'https://zelenaliga.cz/aplikace/deskove-hry',
});

// Send via Resend
await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${RESEND_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    from: 'Zelená Liga <noreply@zelenaliga.cz>',
    to: judgeEmail,
    subject: `Přístup pro rozhodčího – ${eventName}`,
    html,
    reply_to: 'info@zelenaliga.cz',
  }),
});
```

---

### 2. **AuthLinkEmail** (`web/src/emails/AuthLinkEmail.tsx`)
Sends for password reset and passwordless login flows.

**Props:**
- `recipientName` (string, optional) - Recipient's name
- `magicLink` (string) - Authentication link
- `expiresInMinutes` (number, default: 60) - Link expiration time
- `isPasswordReset` (boolean, default: false) - Whether this is a reset or login

**Example - Password Reset:**
```typescript
import { renderEmailToHtml } from '@/emails';
import AuthLinkEmail from '@/emails/AuthLinkEmail';

const html = renderEmailToHtml(AuthLinkEmail, {
  recipientName: 'Jana Součková',
  magicLink: 'https://zelenaliga.cz/auth/reset-password?token=abc123',
  expiresInMinutes: 60,
  isPasswordReset: true,
});

// Subject: "Resetovat heslo"
```

**Example - Passwordless Login:**
```typescript
const html = renderEmailToHtml(AuthLinkEmail, {
  recipientName: 'Jan Novotný',
  magicLink: 'https://zelenaliga.cz/auth/login?token=xyz789',
  expiresInMinutes: 30,
  isPasswordReset: false,
});

// Subject: "Přihlášení do Zelené ligy"
```

---

## Integration Points

### 1. **Password Reset** (`web/api/auth/reset-password.ts`)

**Current Implementation (lines 28-68):**
The `sendResetEmail()` function currently sends a plain HTML email with the temporary password.

**Proposed Integration:**
Replace the manual HTML string with the new `AuthLinkEmail` template:

```typescript
import { renderEmailToHtml } from '../../src/emails/index.js';
import AuthLinkEmail from '../../src/emails/AuthLinkEmail.js';

async function sendResetEmail(to: string, password: string, recipientName?: string): Promise<string> {
  const from = 'Zelená Liga <noreply@zelenaliga.cz>';
  const replyTo = 'info@zelenaliga.cz';
  const subject = 'Resetovat heslo';
  
  // For temporary password reset, construct a reset link
  // This would need to be a real reset link if implementing passwordless flow
  // For now, send the temporary password in a professional template
  
  const html = renderEmailToHtml(AuthLinkEmail, {
    recipientName,
    magicLink: `${process.env.APP_URL || 'https://zelenaliga.cz'}/auth/reset-password?token=temporary`,
    expiresInMinutes: 60,
    isPasswordReset: true,
  });

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      reply_to: replyTo,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to send email (${response.status}): ${body || '<no body>'}`);
  }

  const body = await response.json().catch(() => ({} as Record<string, unknown>));
  const messageId = typeof body?.id === 'string' ? body.id : '';
  return messageId;
}
```

⚠️ **Note:** This integration requires:
1. Changing the temporary password flow to use a proper reset token + link instead of sending the password directly
2. Updating the frontend to handle the reset token from the email link
3. Storing the reset token in the database with expiration

---

### 2. **Judge Onboarding** (`supabase/functions/send-onboarding-emails/index.ts`)

**Current Implementation (lines ~50-120):**
The function sends initial setup instructions with a temporary password via plain HTML.

**Proposed Integration:**
Replace with the new `JudgeAssignmentEmail` template:

```typescript
import { renderEmailToHtml } from '../../src/emails/index.ts';
import JudgeAssignmentEmail from '../../src/emails/JudgeAssignmentEmail.ts';

async function sendOnboardingEmail(
  judgeEmail: string,
  judgeDisplayName: string,
  eventName: string,
  games?: string[],
  categoryName?: string
): Promise<string> {
  const from = 'Zelená Liga <noreply@zelenaliga.cz>';
  const replyTo = 'info@zelenaliga.cz';
  const subject = `Přístup pro rozhodčího – ${eventName}`;

  const html = renderEmailToHtml(JudgeAssignmentEmail, {
    judgeDisplayName,
    eventName,
    games: games || [],
    categoryName: categoryName || null,
    loginUrl: `${Deno.env.get('APP_URL') || 'https://zelenaliga.cz'}/aplikace/deskove-hry`,
  });

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: judgeEmail,
      subject,
      html,
      reply_to: replyTo,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to send email (${response.status}): ${body || '<no body>'}`);
  }

  const body = await response.json().catch(() => ({}));
  return body.id || '';
}
```

---

## Rendering Utilities

### `renderEmailToHtml(component, props)`

Converts a React email template component to an HTML string.

**Features:**
- Works in both Node.js (web/api) and Deno (supabase/functions) environments
- Falls back to basic JSX serialization if ReactDOMServer unavailable
- Handles inline styles, HTML attributes, and React props
- Properly escapes content for security

**Usage:**
```typescript
import { renderEmailToHtml } from '@/emails/render';
import JudgeAssignmentEmail from '@/emails/JudgeAssignmentEmail';

const html = renderEmailToHtml(JudgeAssignmentEmail, {
  judgeDisplayName: 'Jan Novotný',
  eventName: 'Zelená Liga 2026',
  games: ['Ubongo'],
  categoryName: 'Kategorie III + IV',
  loginUrl: 'https://zelenaliga.cz/prihlaseni',
});

console.log(html); // HTML string ready to send
```

### `sendEmail(options)`

Helper function to send emails via Resend API.

**Usage:**
```typescript
import { renderEmailToHtml, sendEmail } from '@/emails';
import JudgeAssignmentEmail from '@/emails/JudgeAssignmentEmail';

const html = renderEmailToHtml(JudgeAssignmentEmail, {
  // ... props
});

const result = await sendEmail({
  to: 'judge@example.com',
  subject: 'Přístup pro rozhodčího – Zelená Liga 2026',
  html,
  from: 'Zelená Liga <noreply@zelenaliga.cz>',
  replyTo: 'info@zelenaliga.cz',
});

console.log(result.id); // Email message ID from Resend
```

---

## Design System

All templates use the Zelená Liga color scheme:

| Element | Color | Hex |
|---------|-------|-----|
| Primary Button | Yellow | `#ffd700` |
| Link Color | Green | `#0b8e3f` |
| Dark Text | Dark Green | `#06642b` |
| Card Background | Light Blue | `#f7fbff` |
| Border | Light Border | `#d4e5f7` |
| Footer Background | Light Gray | `#f9f9f9` |

All emails are:
- ✅ Responsive (max-width: 600px)
- ✅ Compatible with Gmail, Outlook, Apple Mail
- ✅ Use nested tables for email client compatibility
- ✅ Include preheader text for preview
- ✅ Include fallback links for buttons
- ✅ Properly escaped for security

---

## Testing Email Templates

### Local Testing

**Option 1: Using Resend preview**
```bash
# Get a free Resend sandbox URL to test emails
# https://resend.com/emails (register and verify domain)
```

**Option 2: Using email testing service**
```bash
# Use Mailhog or MailCatcher for local testing
# docker run -p 1025:1025 -p 8025:8025 mailhog/mailhog
```

### Rendering Test
```typescript
import { renderEmailToHtml } from '@/emails';
import JudgeAssignmentEmail from '@/emails/JudgeAssignmentEmail';

const html = renderEmailToHtml(JudgeAssignmentEmail, {
  judgeDisplayName: 'Test Judge',
  eventName: 'Test Event',
  games: ['Test Game'],
  categoryName: 'Test Category',
  loginUrl: 'https://example.com/login',
});

// Write to file and open in browser
import fs from 'fs';
fs.writeFileSync('/tmp/email-preview.html', html);
console.log('Email preview: file:///tmp/email-preview.html');
```

---

## Migration Checklist

- [ ] Review current email templates in both locations
- [ ] Update `reset-password.ts` to use `AuthLinkEmail`
- [ ] Update `send-onboarding-emails/index.ts` to use `JudgeAssignmentEmail`
- [ ] Create database migration to store reset tokens (if implementing token-based reset)
- [ ] Test email rendering in all major email clients
- [ ] Update auth flow to handle reset tokens from email links
- [ ] Update onboarding flow to pass event/game/category data
- [ ] Deploy and monitor email delivery
- [ ] Add email preferences/unsubscribe handling if needed

---

## Future Enhancements

1. **React Email Library Integration**
   - Replace manual JSX serializer with `@react-email/render`
   - Add support for `.mjml()` email markup language
   - Get better IDE support and validation

2. **Additional Templates**
   - Event invitation emails
   - Scoring submission confirmation
   - Dispute notification emails
   - Password change confirmation

3. **Email Analytics**
   - Track email opens via Resend dashboard
   - Monitor click rates on CTAs
   - Log delivery issues

4. **Internationalization**
   - Support for Czech, English, and other languages
   - Language selection based on judge preferences

5. **Unsubscribe & Preferences**
   - Email preference center
   - Unsubscribe link in footer
   - GDPR compliance
