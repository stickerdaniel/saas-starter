import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { CONTACT_SETTING_KEY, readAdminSetting } from './founderEmailConfig';

/**
 * Remove a deleted user's founder email rows: the welcome, feedback and
 * cancellation ledgers and their opt-out. Runs inside the Better Auth delete
 * trigger, so a pending send is cancelled in the same transaction that deletes the
 * account. The send would skip a deleted user anyway; cancelling keeps the
 * scheduler from holding their id.
 *
 * A deleted contact person also stops sending: the contact setting naming them
 * goes, which turns all three emails off until another admin becomes the contact.
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

	// eslint-disable-next-line @convex-dev/no-collect-in-query -- At most one suppression row per user; collect also erases a stray duplicate
	const suppressions = await ctx.db
		.query('personalEmailSuppressions')
		.withIndex('by_user', (q) => q.eq('userId', userId))
		.collect();
	for (const row of suppressions) {
		await ctx.db.delete('personalEmailSuppressions', row._id);
	}

	const contact = await readAdminSetting(ctx.db, CONTACT_SETTING_KEY);
	if (contact?.value === userId) await ctx.db.delete('adminSettings', contact._id);
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
