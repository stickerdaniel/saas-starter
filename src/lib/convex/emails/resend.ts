import { components, internal } from '../_generated/api';
import { Resend } from '@convex-dev/resend';
import { getCapabilityConfigurations, requireEmailConfiguration } from '../env';
import type { CapabilityConfiguration, EmailConfiguration } from '../../dev/features';
import { devNotice } from '../../dev/notice';

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
// Module-load notice (no-op outside local dev): RESEND_WEBHOOK_SECRET gates
// webhook signature verification. Without it the component throws inside
// handleResendEventWebhook, so Resend retries 5xx forever and the dev gets
// no useful signal until they look at component internals.
if (!process.env.RESEND_WEBHOOK_SECRET) {
	devNotice({
		feature: 'Resend webhook signature verification',
		missing: ['RESEND_WEBHOOK_SECRET'],
		scope: 'convex'
	});
}

export const resend: Resend = new Resend(components.resend, {
	// Enable test mode in development to prevent accidental sends
	// In test mode, emails can only be sent to: delivered@resend.dev, bounced@resend.dev, complained@resend.dev
	testMode: false, // Set to true to restrict to test addresses only

	// Webhook callback for email events (delivered, bounced, complained, opened, clicked)
	onEmailEvent: internal.emails.events.handleEmailEvent
});

/** Resolve the complete outbound email group at the enqueue boundary. */
export function getEmailDeliveryConfiguration(): CapabilityConfiguration<EmailConfiguration> {
	return getCapabilityConfigurations().email;
}

/**
 * Guard the component enqueue before it can accept work that will never send.
 * The historical name remains stable for existing callers, but the guard now
 * validates the API key, sender address, and public asset URL as one group.
 */
export function assertResendApiKey(
	configuration = getEmailDeliveryConfiguration()
): EmailConfiguration {
	return requireEmailConfiguration(configuration);
}
