import { internalMutation } from '../_generated/server';
import { vEmailId, vEmailEvent } from '@convex-dev/resend';

/**
 * Email event handler - called by Resend webhooks
 *
 * Handles email lifecycle events:
 * - delivered: Email successfully delivered to recipient
 * - bounced: Email bounced (hard or soft bounce)
 * - complained: Recipient marked email as spam
 * - opened: Recipient opened the email (requires tracking)
 * - clicked: Recipient clicked a link (requires tracking)
 *
 * This function is called automatically when Resend sends a webhook event.
 * Configure the webhook URL in Resend dashboard to point to:
 * https://your-deployment.convex.site/resend-webhook
 */
export const handleEmailEvent = internalMutation({
	args: {
		id: vEmailId,
		event: vEmailEvent
	},
	handler: async (ctx, args) => {
		// Log the event for monitoring and debugging
		console.log('Email event received:', {
			emailId: args.id,
			event: args.event
		});

		// Store the event in the database for analytics
		await ctx.db.insert('emailEvents', {
			emailId: args.id,
			eventType: args.event.type,
			timestamp: Date.now(),
			data: args.event
		});

		// Handle specific event types
		switch (args.event.type) {
			case 'email.delivered':
				console.log(`Email ${args.id} delivered successfully`);
				break;

			case 'email.bounced':
				console.warn(`Email ${args.id} bounced:`, args.event.data);
				break;

			case 'email.complained':
				// User marked as spam - important for reputation
				console.warn(`Email ${args.id} marked as spam by recipient`);
				// TODO: Unsubscribe user or add to suppression list
				break;

			case 'email.opened':
				// Email was opened (requires tracking to be enabled)
				console.log(`Email ${args.id} opened by recipient`);
				break;

			case 'email.clicked':
				// Link was clicked (requires tracking to be enabled)
				console.log(`Email ${args.id} link clicked by recipient`);
				break;

			default:
				console.log(`Unknown email event type: ${args.event.type}`);
		}
	}
});
