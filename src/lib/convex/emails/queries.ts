import { v } from 'convex/values';
import { adminQuery } from '../functions';

/**
 * Get email events for a specific email ID
 *
 * Returns all events (delivered, bounced, etc.) for a given email.
 * Useful for tracking email delivery status and debugging issues.
 *
 * @security Requires admin role - email events contain sensitive delivery data
 */
export const getEmailEvents = adminQuery({
	args: {
		emailId: v.string()
	},
	handler: async (ctx, args) => {
		const events = await ctx.db
			.query('emailEvents')
			.withIndex('by_email_id', (q) => q.eq('emailId', args.emailId))
			.collect();

		return events;
	}
});

/**
 * Get recent email events
 *
 * Returns the most recent email events across all emails.
 * Useful for monitoring email system health.
 *
 * @security Requires admin role - email events contain sensitive delivery data
 */
export const getRecentEmailEvents = adminQuery({
	args: {
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const limit = args.limit || 50;

		const events = await ctx.db
			.query('emailEvents')
			.withIndex('by_timestamp')
			.order('desc')
			.take(limit);

		return events;
	}
});

/**
 * Get email events by type
 *
 * Returns email events filtered by type (delivered, bounced, complained, etc.)
 * Useful for analyzing specific email outcomes.
 *
 * @security Requires admin role - email events contain sensitive delivery data
 */
export const getEmailEventsByType = adminQuery({
	args: {
		eventType: v.string(),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const limit = args.limit || 100;

		const events = await ctx.db
			.query('emailEvents')
			.withIndex('by_event_type', (q) => q.eq('eventType', args.eventType))
			.order('desc')
			.take(limit);

		return events;
	}
});

/**
 * Get email statistics
 *
 * Returns aggregated statistics about email events.
 * Useful for dashboards and monitoring.
 *
 * @security Requires admin role - email statistics are sensitive operational data
 */
export const getEmailStats = adminQuery({
	args: {},
	handler: async (ctx) => {
		const allEvents = await ctx.db.query('emailEvents').collect();

		const stats = {
			total: allEvents.length,
			delivered: 0,
			bounced: 0,
			complained: 0,
			opened: 0,
			clicked: 0
		};

		for (const event of allEvents) {
			switch (event.eventType) {
				case 'email.delivered':
					stats.delivered++;
					break;
				case 'email.bounced':
					stats.bounced++;
					break;
				case 'email.complained':
					stats.complained++;
					break;
				case 'email.opened':
					stats.opened++;
					break;
				case 'email.clicked':
					stats.clicked++;
					break;
			}
		}

		return stats;
	}
});
