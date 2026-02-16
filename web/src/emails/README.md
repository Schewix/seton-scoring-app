# Email Templates System

Professional, responsive email templates for the Zelená Liga application using React components.

## 📧 Features

✅ **Professional Design** - Matches Zelená Liga branding (green #0b8e3f, yellow #ffd700)  
✅ **Responsive** - Optimized for desktop, tablet, and mobile (600px max-width)  
✅ **Email-Compatible** - Works in Gmail, Outlook, Apple Mail, Thunderbird, and mobile clients  
✅ **React Components** - Type-safe, reusable email templates  
✅ **No Dependencies** - Works in Node.js and Deno environments  
✅ **Accessible** - Proper heading hierarchy, alt text, fallback links  
✅ **Security** - HTML properly escaped, security notices included  

## 🗂️ Structure

```
web/src/emails/
├── EmailLayout.tsx              # Base components (header, button, card)
├── JudgeAssignmentEmail.tsx     # Judge invitation/assignment emails
├── AuthLinkEmail.tsx            # Password reset & passwordless login
├── render.ts                    # Email rendering utilities
├── index.ts                     # Main exports
├── README.md                    # This file
├── QUICK_REFERENCE.md           # Quick start guide
├── INTEGRATION_GUIDE.md         # Detailed integration instructions
└── EXAMPLES.md                  # Real-world code examples
```

## 🚀 Quick Start

### 1. Render an Email

```typescript
import { renderEmailToHtml } from '@/emails/render';
import { JudgeAssignmentEmail } from '@/emails';

const html = renderEmailToHtml(JudgeAssignmentEmail, {
  judgeDisplayName: 'Jan Novotný',
  eventName: 'Zelená Liga 2026',
  games: ['Ubongo', 'Dominion'],
  categoryName: 'Kategorie III + IV',
  # Email Templates System

  Professional, responsive email templates for the Zelená Liga application using React components.

  ## 📧 Features

  ✅ **Professional Design** - Matches Zelená Liga branding (green #0b8e3f, yellow #ffd700)  
  ✅ **Responsive** - Optimized for desktop, tablet, and mobile (600px max-width)  
  ✅ **Email-Compatible** - Works in Gmail, Outlook, Apple Mail, Thunderbird, and mobile clients  
  ✅ **React Components** - Type-safe, reusable email templates  
  ✅ **No Dependencies** - Works in Node.js and Deno environments  
  ✅ **Accessible** - Proper heading hierarchy, alt text, fallback links  
  ✅ **Security** - HTML properly escaped, security notices included  

  ## 🗂️ Structure

  ```text
  web/src/emails/
  ├── EmailLayout.tsx              # Base components (header, button, card)
  ├── JudgeAssignmentEmail.tsx     # Judge invitation/assignment emails
  ├── AuthLinkEmail.tsx            # Password reset & passwordless login
  ├── render.ts                    # Email rendering utilities
  ├── index.ts                     # Main exports
  ├── README.md                    # This file
  ├── QUICK_REFERENCE.md           # Quick start guide
  ├── INTEGRATION_GUIDE.md         # Detailed integration instructions
  └── EXAMPLES.md                  # Real-world code examples
  ```

## 🚀 Quick Start

### 1. Render an Email

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

## 📧 Available Templates

### JudgeAssignmentEmail

  Sent when a judge is assigned to an event with optional game/category information.

  **Props:**

- `judgeDisplayName` (string) - Judge's name
- `eventName` (string) - Event name
- `games?` (string[]) - Assigned games
- `categoryName?` (string | null) - Assigned category
- `loginUrl` (string) - Login/app link

  **Example:**

  ```typescript
  <JudgeAssignmentEmail
    judgeDisplayName="Jan Novotný"
    eventName="Zelená Liga 2026"
    games={['Ubongo', 'Dominion']}
    categoryName="Kategorie III + IV"
    loginUrl="https://zelenaliga.cz/aplikace/deskove-hry"
  />
  ```

  ---

### AuthLinkEmail

  Used for password reset and passwordless login flows.

  **Props:**

- `recipientName?` (string) - Recipient's name
- `magicLink` (string) - Authentication link URL
- `expiresInMinutes?` (number) - Link expiration (default: 60)
- `isPasswordReset?` (boolean) - Whether this is password reset (default: false)

  **Password Reset Example:**

  ```typescript
  <AuthLinkEmail
    recipientName="Jana Součková"
    magicLink="https://zelenaliga.cz/auth/reset?token=abc123"
    expiresInMinutes={60}
    isPasswordReset={true}
  />
  ```

  **Passwordless Login Example:**

  ```typescript
  <AuthLinkEmail
    recipientName="Jan Novotný"
    magicLink="https://zelenaliga.cz/auth/login?token=xyz789"
    expiresInMinutes={30}
    isPasswordReset={false}
  />
  ```

## 🎨 Design System

  All emails use Zelená Liga branding:

  | Element | Color | Hex |
  |---------|-------|-----|
  | Primary Button | Yellow | `#ffd700` |
  | Primary Link | Green | `#0b8e3f` |
  | Dark Text | Dark Green | `#06642b` |
  | Card Background | Light Blue | `#f7fbff` |
  | Border | Light Border | `#d4e5f7` |
  | Footer Background | Light Gray | `#f9f9f9` |

## 🔧 Utilities

### renderEmailToHtml(component, props)

  Converts a React email component to an HTML string.

  **Features:**

- Works in Node.js and Deno
- Handles inline styles and HTML attributes
- Properly escapes content for security
- Falls back to basic JSX serialization if ReactDOMServer unavailable

  ```typescript
  import { renderEmailToHtml } from '@/emails/render';
  import { JudgeAssignmentEmail } from '@/emails';

  const html = renderEmailToHtml(JudgeAssignmentEmail, {
    judgeDisplayName: 'Test Judge',
    eventName: 'Test Event',
    games: [],
    categoryName: null,
    loginUrl: 'https://zelenaliga.cz/app',
  });
  ```

### sendEmail(options)

  Helper function to send emails via Resend API.

  ```typescript
  import { sendEmail, renderEmailToHtml } from '@/emails';

  const html = renderEmailToHtml(JudgeAssignmentEmail, { /* ... */ });

  const result = await sendEmail({
    to: 'judge@example.com',
    subject: 'Přístup pro rozhodčího',
    html,
  });

  console.log(result.id); // Message ID from Resend
  ```

## 🛠️ Building Custom Templates

  Use the provided components to build new templates:

### EmailLayout

  Main wrapper with header, footer, and preheader.

  ```tsx
  <EmailLayout preheader="Preview text">
    {/* Content */}
  </EmailLayout>
  ```

### EmailButton

  Yellow CTA button.

  ```tsx
  <EmailButton href="https://example.com">
    Click Me
  </EmailButton>
  ```

### EmailCard

  Blue details card.

  ```tsx
  <EmailCard title="Event Details">
    <p><strong>Event:</strong> Zelená Liga 2026</p>
  </EmailCard>
  ```

## 📍 Integration Points

  The email system is ready to integrate with:

  1. **Password Reset** (`web/api/auth/reset-password.ts`)
     - Replace manual HTML with `AuthLinkEmail`
     - Implement token-based reset flow

  2. **Judge Onboarding** (`supabase/functions/send-onboarding-emails/index.ts`)
     - Replace manual HTML with `JudgeAssignmentEmail`
     - Pass event/game/category data
// Open file:///path/to/email-preview.html in browser

```

### Test Rendering

```typescript
import { renderEmailToHtml } from '@/emails/render';
import { JudgeAssignmentEmail } from '@/emails';

try {
  const html = renderEmailToHtml(JudgeAssignmentEmail, {
    judgeDisplayName: 'Test',
    eventName: 'Test',
    games: [],
    categoryName: null,
    loginUrl: 'https://example.com',
  });
  console.log('Rendering successful! HTML length:', html.length);
} catch (error) {
  console.error('Rendering failed:', error);
}
```

## 🚀 Deployment

1. **Install Dependencies** (if upgrading from basic React)

   ```bash
   npm install @react-email/components @react-email/render
   ```

2. **Update Imports** (if switching to React Email library)

   ```typescript
   // Change from:
   import { renderEmailToHtml } from '@/emails/render';
   
   // To:
   import { render } from '@react-email/render';
   ```

3. **Environment Variables**

   ```
   RESEND_API_KEY=re_your_api_key
   APP_URL=https://zelenaliga.cz
   ```

4. **Integration** (see INTEGRATION_GUIDE.md for step-by-step)

## 📝 Future Enhancements

- [ ] Additional email templates (event invitations, scoring notifications)
- [ ] Multi-language support (Czech, English)
- [ ] Email preference center
- [ ] Unsubscribe handling
- [ ] Email analytics integration
- [ ] React Email library integration (@react-email/components)

## 📄 License

Part of the Zelená Liga application. See LICENSE file.

## 💬 Support

For questions about email templates, see:

- QUICK_REFERENCE.md - Common tasks
- INTEGRATION_GUIDE.md - Integration help
- EXAMPLES.md - Code examples
