/**
 * Email Templates & Utilities
 * 
 * Exports all email templates and rendering utilities for use throughout the application
 * 
 * Templates:
 * - JudgeAssignmentEmail: Sent when a judge is assigned to an event
 * - AuthLinkEmail: Sent for password reset and passwordless login
 * 
 * Utilities:
 * - renderEmailToHtml: Convert React components to HTML strings
 * - sendEmail: Send emails via Resend API
 */

export {
  JudgeAssignmentEmail,
  renderJudgeAssignmentEmail,
  type JudgeAssignmentEmailProps,
} from './JudgeAssignmentEmail';

export {
  AuthLinkEmail,
  renderAuthLinkEmail,
  type AuthLinkEmailProps,
} from './AuthLinkEmail';

export {
  renderEmailToHtml,
  sendEmail,
  type EmailOptions,
} from './render';

export {
  EmailLayout,
  EmailButton,
  EmailCard,
} from './EmailLayout';
