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

/**
 * Throws a loud, copy-paste-friendly error when RESEND_API_KEY is not set.
 *
 * Without this preflight, the Resend SDK accepts the send call and queues it,
 * but the actual API call fails inside the component's workpool. The Better
 * Auth verify-email flow then "succeeds" from the user's perspective while no
 * email ever arrives. Calling this at the top of every email-sending handler
 * converts that silent hang into an immediate, named failure in Convex logs.
 *
 * AUTH_EMAIL presence is already covered by `requireEnv('AUTH_EMAIL', ...)` in
 * each handler's `from` argument; this helper only guards the API key.
 */
export function assertResendApiKey(): void {
	if (process.env.RESEND_API_KEY) return;
	// E2E test runs propagate AUTH_E2E_TEST_SECRET into the Convex backend
	// (vite.config.ts) and intentionally do not configure Resend. Stay quiet there.
	if (process.env.AUTH_E2E_TEST_SECRET) return;

	throw new Error(
		`[env] Missing RESEND_API_KEY (needed for: email delivery)\n` +
			`  Fix: bunx convex env set RESEND_API_KEY <value>\n` +
			`  See: .env.convex.example`
	);
}
