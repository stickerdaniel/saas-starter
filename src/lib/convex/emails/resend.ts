import { components, internal } from '../_generated/api';
import { Resend } from '@convex-dev/resend';

/**
 * Resend email client configured for the application.
 *
 * Features:
 * - Automatic queuing and batching
 * - Durable execution (survives server restarts)
 * - Built-in idempotency (prevents duplicate sends)
 * - Rate limit compliance
 * - Email event tracking via webhooks
 *
 * Configuration:
 * - testMode: Restricts delivery to test addresses in development
 * - onEmailEvent: Webhook callback for email status updates
 *
 * Environment Variables (set via: bunx convex env set KEY value):
 * - RESEND_API_KEY: Your Resend API key (required)
 * - RESEND_WEBHOOK_SECRET: Webhook signing secret (optional)
 */
export const resend: Resend = new Resend(components.resend, {
	// Enable test mode in development to prevent accidental sends
	// In test mode, emails can only be sent to: delivered@resend.dev, bounced@resend.dev, complained@resend.dev
	testMode: false, // Set to true to restrict to test addresses only

	// Webhook callback for email events (delivered, bounced, complained, opened, clicked)
	onEmailEvent: internal.emails.events.handleEmailEvent
});
