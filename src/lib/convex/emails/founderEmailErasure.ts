import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { FOUNDER_EMAILS, LEGACY_CONTACT_SETTING_KEY } from './founderEmailConfig';

/**
 * Remove a deleted user's founder email rows: the welcome, feedback and
 * cancellation ledgers. Runs inside the Better Auth delete trigger, so a pending
 * send is cancelled in the same transaction that deletes the account. The send
 * would skip a deleted user anyway; cancelling keeps the scheduler from holding
 * their id.
 *
 * A deleted admin who sends an email also stops sending it: their sender row keeps
 * the email explicitly off, and a legacy welcome contact setting naming them goes.
 */
export async function eraseFounderEmailRows(ctx: MutationCtx, userId: string): Promise<void> {
	// eslint-disable-next-line @convex-dev/no-collect-in-query -- At most one welcome row per user; collect also erases a stray duplicate
	const welcomeRows = await ctx.db
		.query('founderWelcomeEmails')
		.withIndex('by_user', (q) => q.eq('userId', userId))
		.collect();
	for (const row of welcomeRows) {
		if (row.status === 'scheduled' && row.scheduledFnId) {
			await cancelPendingSend(ctx, row.scheduledFnId);
		}
		await ctx.db.delete('founderWelcomeEmails', row._id);
	}
	// eslint-disable-next-line @convex-dev/no-collect-in-query -- One feedback row and one row per cancellation, a handful per user
	const sendRows = await ctx.db
		.query('founderEmailSends')
		.withIndex('by_userId_and_email_and_dedupeKey', (q) => q.eq('userId', userId))
		.collect();
	for (const row of sendRows) {
		if (row.status === 'scheduled' && row.scheduledFnId) {
			await cancelPendingSend(ctx, row.scheduledFnId);
		}
		await ctx.db.delete('founderEmailSends', row._id);
	}

	// Sender rows: at most one per email. Blank the deleted admin's identity but keep
	// the row as an explicit "off"; deleting a welcome row would hand the welcome back
	// to the legacy contact person.
	for (const email of FOUNDER_EMAILS) {
		const sender = await ctx.db
			.query('founderEmailSenders')
			.withIndex('by_email', (q) => q.eq('email', email))
			.unique();
		if (!sender) continue;
		if (sender.senderUserId !== userId && sender.updatedBy !== userId) continue;
		await ctx.db.patch('founderEmailSenders', sender._id, {
			senderUserId: undefined,
			name: '',
			title: '',
			replyTo: undefined,
			enabledAt: undefined,
			updatedBy: '',
			updatedAt: Date.now()
		});
	}

	const legacyContact = await ctx.db
		.query('adminSettings')
		.withIndex('by_key', (q) => q.eq('key', LEGACY_CONTACT_SETTING_KEY))
		.unique();
	if (legacyContact?.value === userId) await ctx.db.delete('adminSettings', legacyContact._id);
}

/** Cancel a scheduled send that has not started; a finished job needs nothing. */
async function cancelPendingSend(
	ctx: MutationCtx,
	scheduledFnId: Id<'_scheduled_functions'>
): Promise<void> {
	const job = await ctx.db.system.get('_scheduled_functions', scheduledFnId);
	if (job?.state.kind === 'pending') {
		await ctx.scheduler.cancel(scheduledFnId);
	}
}
