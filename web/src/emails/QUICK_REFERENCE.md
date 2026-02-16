# Email Templates - Quick Reference

## Files & Structure

```
web/src/emails/
├── EmailLayout.tsx              # Base layout components
├── JudgeAssignmentEmail.tsx     # Judge invitation email
├── AuthLinkEmail.tsx            # Password reset / passwordless login
├── render.ts                    # Rendering utilities
├── index.ts                     # Main exports
├── INTEGRATION_GUIDE.md         # Detailed integration guide
└── QUICK_REFERENCE.md           # This file
```

## Quick Start

### 1. Render an Email Template

```typescript
import { renderEmailToHtml } from '@/emails/render';
import { JudgeAssignmentEmail } from '@/emails';

const html = renderEmailToHtml(JudgeAssignmentEmail, {
  judgeDisplayName: 'Jan Novotný',
  eventName: 'Zelená Liga 2026',
  games: ['Ubongo', 'Dominion'],
  categoryName: 'Kategorie III + IV',
  loginUrl: 'https://zelenaliga.cz/aplikace/deskove-hry',
});

// html is now a string ready to send via Resend
```

### 2. Send via Resend API

# Email Templates - Quick Reference

## Files & Structure

```text
web/src/emails/
├── EmailLayout.tsx              # Base layout components
├── JudgeAssignmentEmail.tsx     # Judge invitation email
├── AuthLinkEmail.tsx            # Password reset / passwordless login
├── render.ts                    # Rendering utilities
├── index.ts                     # Main exports
├── INTEGRATION_GUIDE.md         # Detailed integration guide
└── QUICK_REFERENCE.md           # This file
```

## Quick Start

### 1. Render an Email Template

```typescript
import { renderEmailToHtml } from '@/emails/render';
import { JudgeAssignmentEmail } from '@/emails';

const html = renderEmailToHtml(JudgeAssignmentEmail, {
  judgeDisplayName: 'Jan Novotný',
  eventName: 'Zelená Liga 2026',
  games: ['Ubongo', 'Dominion'],
  categoryName: 'Kategorie III + IV',
  loginUrl: 'https://zelenaliga.cz/aplikace/deskove-hry',
});

// html is now a string ready to send via Resend
```

### 2. Send via Resend API

```typescript
const response = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
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

const { id } = await response.json();
console.log(`Email sent: ${id}`);
```

### 3. Or Use Helper Function

```typescript
import { sendEmail, renderEmailToHtml } from '@/emails';
import { JudgeAssignmentEmail } from '@/emails';

const html = renderEmailToHtml(JudgeAssignmentEmail, {
  // ... props
});

const result = await sendEmail({
  to: 'judge@example.com',
  subject: 'Přístup pro rozhodčího – Zelená Liga 2026',
  html,
});

console.log(result.id);
```

---

## Template Reference

### Judge Assignment Email

**When to use:** Judge assigned to an event ✉️

**Props:**

```typescript
{
  judgeDisplayName: string;           // Judge's name
  eventName: string;                  // Event name
  games?: string[];                   // Optional: ["Game1", "Game2"]
  categoryName?: string | null;       // Optional: "Kategorie III + IV"
  loginUrl: string;                   // CTA link
}
```

**Example:**

```typescript
import { renderEmailToHtml } from '@/emails/render';
import { JudgeAssignmentEmail } from '@/emails';

const html = renderEmailToHtml(JudgeAssignmentEmail, {
  judgeDisplayName: 'Jan Novotný',
  eventName: 'Zelená Liga 2026',
  games: ['Ubongo'],
  categoryName: 'Kategorie III + IV',
  loginUrl: 'https://zelenaliga.cz/aplikace/deskove-hry',
});
```

---

### Auth Link Email

**When to use:** Password reset or passwordless login 🔐

**Props:**

```typescript
{
  recipientName?: string;             // Optional: "Jana Součková"
  magicLink: string;                  // Auth link URL
  expiresInMinutes?: number;          // Default: 60
  isPasswordReset?: boolean;          // Default: false
}
```

**Password Reset Example:**

```typescript
import { renderEmailToHtml } from '@/emails/render';
import { AuthLinkEmail } from '@/emails';

const html = renderEmailToHtml(AuthLinkEmail, {
  recipientName: 'Jana Součková',
  magicLink: 'https://zelenaliga.cz/auth/reset?token=abc123',
  expiresInMinutes: 60,
  isPasswordReset: true,  // Shows "Resetovat heslo" subject
});
```

**Passwordless Login Example:**

```typescript
const html = renderEmailToHtml(AuthLinkEmail, {
  recipientName: 'Jan Novotný',
  magicLink: 'https://zelenaliga.cz/auth/login?token=xyz789',
  expiresInMinutes: 30,
  isPasswordReset: false,  // Shows "Přihlášení do Zelené ligy" subject
});
```

---

## Component Building Blocks

Use these in custom email templates:

### EmailLayout

**Wrapper component with header, footer, preheader**

```tsx
<EmailLayout preheader="Preview text for email client">
  {/* Your email content */}
</EmailLayout>
```

### EmailButton

**Yellow CTA button**

```tsx
<EmailButton href="https://example.com">
  Click Me
</EmailButton>
```

### EmailCard

**Blue details card with title**

```tsx
<EmailCard title="Event Details">
  <p><strong>Event:</strong> Zelená Liga 2026</p>
  <p><strong>Category:</strong> Kategorie III</p>
</EmailCard>
```

---

## Integration Locations

### Current Email Sending Points

1. **Password Reset**
   - File: `web/api/auth/reset-password.ts`
   - Function: `sendResetEmail()` at line 28
   - Action: Replace manual HTML with `AuthLinkEmail`

2. **Judge Onboarding**
   - File: `supabase/functions/send-onboarding-emails/index.ts`
   - Function: `sendEmail()` at line ~53
   - Action: Replace manual HTML with `JudgeAssignmentEmail`

---

## Design Colors

```text
Primary Green:     #0b8e3f  (links, headers)
Dark Green:        #06642b  (text emphasis, card titles)
CTA Yellow:       #ffd700  (buttons)
Background:       #f7fbff  (card backgrounds)
Border:           #d4e5f7  (dividers)
Footer BG:        #f9f9f9  (footer)
```

---

## Browser/Email Client Support

✅ Gmail
✅ Outlook
✅ Apple Mail
✅ Thunderbird
✅ Mobile clients (iOS Mail, Gmail app)

All templates use:

- Nested tables (email client compatibility)
- Inline styles (no CSS classes)
- Max-width: 600px (responsive)
- Preheader text (preview support)
- Fallback links (button fallback)

---

## Common Tasks

### Preview Email in Browser

```typescript
import fs from 'fs';
import { renderEmailToHtml } from '@/emails/render';
import { JudgeAssignmentEmail } from '@/emails';

const html = renderEmailToHtml(JudgeAssignmentEmail, {
  judgeDisplayName: 'Test Judge',
  eventName: 'Test Event',
  games: ['Test Game'],
  categoryName: 'Test Category',
  loginUrl: 'https://example.com/login',
});

fs.writeFileSync('./email-preview.html', html);
// Open file:///path/to/email-preview.html in browser
```

### Debug Email Rendering

```typescript
import { renderEmailToHtml } from '@/emails/render';
import { JudgeAssignmentEmail } from '@/emails';

try {
  const html = renderEmailToHtml(JudgeAssignmentEmail, props);
  console.log('HTML length:', html.length);
  console.log('HTML preview:', html.slice(0, 200));
} catch (error) {
  console.error('Rendering failed:', error);
}
```

### Test Email Delivery

```typescript
import { sendEmail, renderEmailToHtml } from '@/emails';
import { JudgeAssignmentEmail } from '@/emails';

const testEmail = 'test@example.com';
const html = renderEmailToHtml(JudgeAssignmentEmail, {
  judgeDisplayName: 'Test Judge',
  eventName: 'Test Event',
  games: [],
  categoryName: null,
  loginUrl: 'https://zelenaliga.cz/aplikace/deskove-hry',
});

const result = await sendEmail({
  to: testEmail,
  subject: 'Test: Přístup pro rozhodčího',
  html,
});

console.log('Email sent:', result.id);
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Email not rendering | Check RESEND_API_KEY env var |
| Images not showing | Use absolute URLs (https://...) |
| Buttons not working | Email clients may block images; fallback links provided |
| Wrong colors in Outlook | Inline styles take precedence (Outlook limitation) |
| Too wide on mobile | Max-width: 600px applied; verify email client doesn't override |

---

## Next Steps

See **INTEGRATION_GUIDE.md** for:

- Detailed integration steps
- Migration checklist
- Testing procedures
- Future enhancements
