/**

* Email Integration Examples
/**
* Email Integration Examples
*
* Real-world examples showing how to use the email templates
* in the Zelená Liga application
 */

// ============================================================================
// EXAMPLE 1: Password Reset Flow (web/api/auth/reset-password.ts)
// ============================================================================

import { renderEmailToHtml } from '../../src/emails/index.js';
import { AuthLinkEmail } from '../../src/emails/index.js';

async function exampleResetPasswordEmail(
  email: string,
  judgeId: string,
  resetToken: string
): Promise<void> {
  const resetLink = `${process.env.APP_URL || 'https://zelenaliga.cz'}/auth/reset-password?token=${resetToken}`;

  // Render the email template
  const html = renderEmailToHtml(AuthLinkEmail, {
    recipientName: 'Jan Novotný', // Get from database query
    magicLink: resetLink,
    expiresInMinutes: 60, // Token expiration
    isPasswordReset: true, // Shows "Resetovat heslo" heading
  });

  // Send via Resend API
  const response = await fetch('<https://api.resend.com/emails>', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Zelená Liga <noreply@zelenaliga.cz>',
      to: email,
      subject: 'Resetovat heslo',
      html,
      reply_to: '<info@zelenaliga.cz>',
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to send email: ${response.statusText}`);
  }

  const { id } = await response.json();
  console.log(`Password reset email sent: ${id}`);
}

// ============================================================================
// EXAMPLE 2: Judge Assignment (supabase/functions/send-onboarding-emails/index.ts)
// ============================================================================

import { JudgeAssignmentEmail } from '../../src/emails/JudgeAssignmentEmail.ts';
import { renderEmailToHtml } from '../../src/emails/render.ts';

async function exampleJudgeAssignmentEmail(
  judgeEmail: string,
  judgeDisplayName: string,
  eventName: string,
  assignedGames: string[],
  categoryName: string | null
): Promise<void> {
  // Render the email template
  const html = renderEmailToHtml(JudgeAssignmentEmail, {
    judgeDisplayName,
    eventName,
    games: assignedGames,
    categoryName,
    loginUrl: `${Deno.env.get('APP_URL') || 'https://zelenaliga.cz'}/aplikace/deskove-hry`,
  });

  // Send via Resend API
  const response = await fetch('<https://api.resend.com/emails>', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Zelená Liga <noreply@zelenaliga.cz>',
      to: judgeEmail,
      subject: `Přístup pro rozhodčího – ${eventName}`,
      html,
      reply_to: '<info@zelenaliga.cz>',
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to send email: ${response.statusText}`);
  }

  const { id } = await response.json();
  console.log(`Judge assignment email sent: ${id}`);
}

// ============================================================================
// EXAMPLE 3: Complete Integration with Database Logging
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { renderEmailToHtml } from '@/emails';
import { JudgeAssignmentEmail } from '@/emails';

async function assignJudgeAndNotify(
  judgeId: string,
  eventId: string,
  eventName: string,
  assignedGames: string[],
  categoryName: string | null
): Promise<void> {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1. Get judge details from database
  const { data: judge, error: judgeError } = await supabase
    .from('judges')
    .select('id, email, first_name, last_name')
    .eq('id', judgeId)
    .single();

  if (judgeError || !judge) {
    throw new Error('Judge not found');
  }

  const judgeDisplayName = `${judge.first_name} ${judge.last_name}`;

  // 2. Render email
  const html = renderEmailToHtml(JudgeAssignmentEmail, {
    judgeDisplayName,
    eventName,
    games: assignedGames,
    categoryName,
    loginUrl: `${process.env.APP_URL}/aplikace/deskove-hry`,
  });

  // 3. Send email
  const emailResponse = await fetch('<https://api.resend.com/emails>', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Zelená Liga <noreply@zelenaliga.cz>',
      to: judge.email,
      subject: `Přístup pro rozhodčího – ${eventName}`,
      html,
      reply_to: '<info@zelenaliga.cz>',
    }),
  });

  if (!emailResponse.ok) {
    throw new Error(`Failed to send email: ${emailResponse.statusText}`);
  }

  const { id: emailMessageId } = await emailResponse.json();

  // 4. Log the notification event
  const { error: logError } = await supabase
    .from('judge_notifications')
    .insert({
      judge_id: judgeId,
      event_id: eventId,
      type: 'assignment',
      email: judge.email,
      message_id: emailMessageId,
      status: 'sent',
      created_at: new Date().toISOString(),
      metadata: {
        games: assignedGames,
        categoryName,
      },
    });

  if (logError) {
    console.error('Failed to log notification:', logError);
  }

  console.log(`Judge ${judgeId} assigned and notified for event ${eventId}`);
}

// ============================================================================
// EXAMPLE 4: Error Handling & Retry Logic
// ============================================================================

async function sendEmailWithRetry(
  to: string,
  subject: string,
  html: string,
  maxRetries: number = 3
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch('<https://api.resend.com/emails>', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Zelená Liga <noreply@zelenaliga.cz>',
          to,
          subject,
          html,
          reply_to: '<info@zelenaliga.cz>',
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Resend API error: ${error.message}`);
      }

      const { id } = await response.json();
      console.log(`Email sent successfully: ${id}`);
      return id;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`Email send attempt ${attempt} failed:`, lastError.message);

      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, attempt - 1) * 1000;
        console.log(`Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(
    `Failed to send email after ${maxRetries} attempts. Last error: ${lastError?.message}`
  );
}

// Usage with retry:
// const html = renderEmailToHtml(JudgeAssignmentEmail, { /*...*/ });
// const messageId = await sendEmailWithRetry(judgeEmail, subject, html);

// ============================================================================
// EXAMPLE 5: Testing Email Rendering Locally
// ============================================================================

async function exampleTestEmailRendering(): Promise<void> {
  import { renderEmailToHtml } from '@/emails';
  import { JudgeAssignmentEmail } from '@/emails';
  import fs from 'fs';

  // Render example email
  const html = renderEmailToHtml(JudgeAssignmentEmail, {
    judgeDisplayName: 'Test Judge',
    eventName: 'Test Event 2026',
    games: ['Ubongo', 'Dominion', 'Azul'],
    categoryName: 'Kategorie III + IV',
    loginUrl: '<https://zelenaliga.cz/aplikace/deskove-hry>',
  });

  // Save to file
  fs.writeFileSync('./email-preview.html', html);
  console.log('Email preview saved to: ./email-preview.html');

  // Also log first 500 characters
  console.log('Email HTML preview (first 500 chars):');
  console.log(html.slice(0, 500));
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  exampleResetPasswordEmail,
  exampleJudgeAssignmentEmail,
  assignJudgeAndNotify,
  sendEmailWithRetry,
  exampleTestEmailRendering,
};
