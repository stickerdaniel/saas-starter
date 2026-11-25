import { internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { MutationCtx } from '../../convex/_generated/server';
import { CONTACT_SETTING_KEY, readAdminSetting } from './founderEmailConfig';

/**
 * Erase a deleted user's founder email rows in bounded pages: the welcome,
 * feedback and cancellation ledgers and their opt-out. Each erased row first loses
 * what could still reach the user: its scheduled send while pending, and its
 * component email while the Resend component still holds it (`waiting` or
 * `queued`). A welcome row written before the component email id was stored has
 * no id to cancel and is only deleted.
 *
 * The account deletion trigger runs the first page (`startFounderEmailErasure`);
 * `continueFounderEmailErasure` runs every later one, scheduled only when an
 * indexed probe finds rows left. A user cancels one subscription after another,
 * so their cancellation episodes have no fixed bound.
 *
 * A deleted contact person also stops sending: the contact setting naming them
 * goes in the trigger itself, which turns all three emails off until another
 * admin becomes the contact.
 */

const MiB = 1024 * 1024;

/** Every page runs as a child transaction under these limits. */
const ERASURE_PAGE_LIMITS = { documentsRead: 1000, bytesRead: 4 * MiB, documentsWritten: 300 };

/**
 * Rows erased per page. Each costs a component status read and possibly a
 * cancellation, like a row of the admin customer email erasure.
 */
export const ROWS_PER_PAGE = 50;

/** Delay before attempts 2, 3 and 4 of a failed page; attempt 4 is the last. */
const RETRY_DELAYS_MS = [60_000, 10 * 60_000, 60 * 60_000];

export function welcomeRows(ctx: MutationCtx, userId: string) {
	return ctx.db.query('founderWelcomeEmails').withIndex('by_user', (q) => q.eq('userId', userId));
}

export function sendRows(ctx: MutationCtx, userId: string) {
	return ctx.db
		.query('founderEmailSends')
		.withIndex('by_userId_and_email_and_dedupeKey', (q) => q.eq('userId', userId));
}

export function suppressionRows(ctx: MutationCtx, userId: string) {
	return ctx.db
		.query('personalEmailSuppressions')
		.withIndex('by_user', (q) => q.eq('userId', userId));
}

/** Cancel a scheduled send that has not started; a finished job needs nothing. */
export async function cancelPendingSend(
	ctx: MutationCtx,
	scheduledFnId: Id<'_scheduled_functions'> | undefined
): Promise<void> {
	if (!scheduledFnId) return;
	const job = await ctx.db.system.get('_scheduled_functions', scheduledFnId);
	if (job?.state.kind === 'pending') {
		await ctx.scheduler.cancel(scheduledFnId);
	}
}

/**
 * Run one page as a caught child transaction, then schedule what follows: the
 * next page when rows remain, the next attempt after a failure, or nothing. A
 * page that still fails on its last attempt logs `founder_email_erasure_blocked`
 * and leaves its rows in place, so rerunning `continueFounderEmailErasure` for the
 * user after the cause is fixed resumes it.
 */
export async function runErasurePage(
	ctx: MutationCtx,
	userId: string,
	attempt: number
): Promise<void> {
	let more: boolean;
	try {
		more = await ctx.runMutation(
			internal.emails.founderEmailErasure.eraseFounderEmailPage,
			{ userId },
			{ transactionLimits: ERASURE_PAGE_LIMITS }
		);
	} catch {
		const delay = RETRY_DELAYS_MS[attempt - 1];
		if (delay === undefined) {
			console.error({ code: 'founder_email_erasure_blocked', userId });
			return;
		}
		await ctx.scheduler.runAfter(
			delay,
			internal.emails.founderEmailErasure.continueFounderEmailErasure,
			{ userId, attempt: attempt + 1 }
		);
		return;
	}
	if (more) {
		await ctx.scheduler.runAfter(
			0,
			internal.emails.founderEmailErasure.continueFounderEmailErasure,
			{ userId, attempt: 1 }
		);
	}
}

/**
 * Start erasure from the account deletion trigger. The first page is attempt 1
 * and runs as a caught child, so its failure never blocks the deletion.
 */
export async function startFounderEmailErasure(ctx: MutationCtx, userId: string): Promise<void> {
	const contact = await readAdminSetting(ctx.db, CONTACT_SETTING_KEY);
	if (contact?.value === userId) await ctx.db.delete('adminSettings', contact._id);
	await runErasurePage(ctx, userId, 1);
}
