import { v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalMutation, type MutationCtx } from '../_generated/server';
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
const ROWS_PER_PAGE = 50;

/** Delay before attempts 2, 3 and 4 of a failed page; attempt 4 is the last. */
const RETRY_DELAYS_MS = [60_000, 10 * 60_000, 60 * 60_000];

function welcomeRows(ctx: MutationCtx, userId: string) {
	return ctx.db.query('founderWelcomeEmails').withIndex('by_user', (q) => q.eq('userId', userId));
}

function sendRows(ctx: MutationCtx, userId: string) {
	return ctx.db
		.query('founderEmailSends')
		.withIndex('by_userId_and_email_and_dedupeKey', (q) => q.eq('userId', userId));
}

function suppressionRows(ctx: MutationCtx, userId: string) {
	return ctx.db
		.query('personalEmailSuppressions')
		.withIndex('by_user', (q) => q.eq('userId', userId));
}

/** Cancel a scheduled send that has not started; a finished job needs nothing. */
async function cancelPendingSend(
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
 * One page: up to {@link ROWS_PER_PAGE} rows, welcome rows first. Progresses by
 * deletion, so every page starts from the front. Returns whether rows remain. A
 * failed cancellation throws, which rolls the page back for a retry.
 */
export const eraseFounderEmailPage = internalMutation({
	args: { userId: v.string() },
	returns: v.boolean(),
	handler: async (ctx, { userId }) => {
		const welcomes = await welcomeRows(ctx, userId).take(ROWS_PER_PAGE);
		const sends = await sendRows(ctx, userId).take(ROWS_PER_PAGE - welcomes.length);
		const suppressions = await suppressionRows(ctx, userId).take(
			ROWS_PER_PAGE - welcomes.length - sends.length
		);

		const emailIds = [...welcomes, ...sends].flatMap((row) => (row.emailId ? [row.emailId] : []));
		if (emailIds.length > 0) {
			// By reference, which keeps the Resend client out of the deletion trigger's
			// import graph.
			await ctx.runMutation(internal.admin.customerNotifications.cancel.cancelUnsentEmails, {
				emailIds
			});
		}
		for (const row of welcomes) {
			await cancelPendingSend(ctx, row.scheduledFnId);
			await ctx.db.delete('founderWelcomeEmails', row._id);
		}
		for (const row of sends) {
			await cancelPendingSend(ctx, row.scheduledFnId);
			await ctx.db.delete('founderEmailSends', row._id);
		}
		for (const row of suppressions) {
			await ctx.db.delete('personalEmailSuppressions', row._id);
		}

		return (
			(await welcomeRows(ctx, userId).first()) !== null ||
			(await sendRows(ctx, userId).first()) !== null ||
			(await suppressionRows(ctx, userId).first()) !== null
		);
	}
});

/**
 * Run one page as a caught child transaction, then schedule what follows: the
 * next page when rows remain, the next attempt after a failure, or nothing. A
 * page that still fails on its last attempt logs `founder_email_erasure_blocked`
 * and leaves its rows in place, so rerunning `continueFounderEmailErasure` for the
 * user after the cause is fixed resumes it.
 */
async function runErasurePage(ctx: MutationCtx, userId: string, attempt: number): Promise<void> {
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

export const continueFounderEmailErasure = internalMutation({
	args: { userId: v.string(), attempt: v.number() },
	returns: v.null(),
	handler: async (ctx, { userId, attempt }) => {
		await runErasurePage(ctx, userId, attempt);
		return null;
	}
});
