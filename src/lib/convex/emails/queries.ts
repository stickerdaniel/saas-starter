import { query } from '../_generated/server';
import { v } from 'convex/values';

/**
 * Get email events for a specific email ID
 *
 * Returns all events (delivered, bounced, etc.) for a given email.
 * Useful for tracking email delivery status and debugging issues.
 */
export const getEmailEvents = query({
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
 */
export const getRecentEmailEvents = query({
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
 */
export const getEmailEventsByType = query({
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
 */
export const getEmailStats = query({
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
