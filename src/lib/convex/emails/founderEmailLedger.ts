import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';

/**
 * Ledger reads for the founder email billing actions. Kept apart from
 * `founderEmails.ts`, whose send path loads the Resend client and the email
 * renderer at module load: these queries touch only this database, so a cold
 * query isolate loads nothing else first.
 */

/**
 * Whether a founder email row is still waiting for its billing answer. The billing
 * actions check it before any provider read, so a row that was sent, skipped or
 * erased since the action was scheduled costs no Autumn or Resend call.
 */
export const isFounderEmailSendPending = internalQuery({
	args: { sendId: v.id('founderEmailSends') },
	returns: v.boolean(),
	handler: async (ctx, { sendId }) => {
		const row = await ctx.db.get('founderEmailSends', sendId);
		return row?.status === 'scheduled';
	}
});

/**
 * The component email id and subject of the user's sent welcome, which a feedback
 * email can reply to. Null without a sent welcome.
 */
export const getSentFounderWelcome = internalQuery({
	args: { userId: v.string() },
	returns: v.union(v.null(), v.object({ emailId: v.string(), subject: v.string() })),
	handler: async (ctx, { userId }) => {
		const row = await ctx.db
			.query('founderWelcomeEmails')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.unique();
		if (row?.status !== 'sent' || !row.emailId || !row.subject) return null;
		return { emailId: row.emailId, subject: row.subject };
	}
});
