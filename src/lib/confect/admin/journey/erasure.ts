import * as Effect from 'effect/Effect';
import { internal } from '../../../convex/_generated/api';
import type { Doc } from '../../../convex/_generated/dataModel';
import type { MutationCtx as ConvexMutationCtx } from '../../../convex/_generated/server';
import { MutationCtx, Scheduler } from '../../_generated/services';
import {
	ErasureStepSchema,
	type ContinuationSchema,
	type ErasurePageArgsSchema,
	type ErasureRunSchema
} from './schemas';

/**
 * Erase the journey facts of a deleted user, in bounded pages.
 *
 * The account deletion trigger runs the first page (`startJourneyErasure`);
 * `continueErasure` runs every later one. Each page does real work in at most
 * one step and hands over through steps that have nothing to do, so no page is
 * ever scheduled for an empty step. The records themselves (community
 * messages, support threads) outlive the user; only the facts this feature
 * added are removed or cleared, and the admin customer emails about the user
 * that have not left yet are cancelled.
 */

type ErasureStep = typeof ErasureStepSchema.Type;

/** Steps run in this order. */
const ERASURE_ORDER = ErasureStepSchema.literals;

type Continuation = typeof ContinuationSchema.Type;

const MiB = 1024 * 1024;

/** Every page runs as a child transaction under these limits. */
const ERASURE_PAGE_LIMITS = { documentsRead: 2000, bytesRead: 4 * MiB, documentsWritten: 600 };

/** Delay before attempts 2, 3 and 4 of a failed page; attempt 4 is the last. */
const RETRY_DELAYS_MS = [60_000, 10 * 60_000, 60 * 60_000];

// A row holds at most MAX_RECIPIENTS email ids, and each id costs a status
// read and possibly a cancellation, so a page also stops before 100 ids.
const LEDGER_PAGE = { rows: 25, emailIds: 100 };
const RECEIPTS_PER_PAGE = 500;
const COMMUNITY_PAGE = { numItems: 200, maximumBytesRead: 2 * MiB };
// A support page reads up to its byte allowance plus the thread that crosses
// it, patching rereads those threads, and the probe reads one more. With
// threads near the 1 MiB document limit, 2 × (256 KiB + 1 MiB) + 1 MiB stays
// inside the page's 4 MiB.
const SUPPORT_PAGE = { numItems: 50, maximumBytesRead: MiB / 4 };

type StepOutcome =
	/** Nothing to do here; the page moves on to the next step. */
	| { kind: 'empty' }
	/**
	 * Work done and more may remain in this step. The page probes the step
	 * before scheduling the next page here, because a full page cannot tell
	 * whether it took the last row.
	 */
	| { kind: 'progress'; cursor?: string }
	/** Work done and this step is complete. */
	| { kind: 'finished' };

const EMPTY: StepOutcome = { kind: 'empty' };
const PROGRESS: StepOutcome = { kind: 'progress' };
const FINISHED: StepOutcome = { kind: 'finished' };

type StepEffect<A> = Effect.Effect<A, never, MutationCtx | Scheduler>;

type StepDefinition = {
	/** Whether `run` calls `.paginate`, which Convex allows once per function. */
	paginates: boolean;
	run(userId: string, cursor: string | undefined): StepEffect<StepOutcome>;
	/** Bounded check for whether a page of this step could find anything. */
	probe(userId: string): StepEffect<boolean>;
};

const withCtx = <A>(run: (ctx: ConvexMutationCtx) => Promise<A>) =>
	MutationCtx.use((ctx) => Effect.promise(() => run(ctx)));

const noProgress = Effect.die(new Error('journey_erasure_no_progress'));

function notificationRows(ctx: ConvexMutationCtx, userId: string) {
	return ctx.db.query('customerNotifications').withIndex('by_user', (q) => q.eq('userId', userId));
}

/**
 * Cancel a ledger row's scheduled send while it is `pending`: the scheduler
 * would also mark a running send cancelled, and every other state is final.
 */
const cancelPendingSend = ({ scheduledFnId }: Doc<'customerNotifications'>) =>
	Effect.gen(function* () {
		if (!scheduledFnId) return;
		const job = yield* withCtx((ctx) => ctx.db.system.get('_scheduled_functions', scheduledFnId));
		if (job?.state.kind === 'pending') yield* (yield* Scheduler).cancel(scheduledFnId);
	});

function settledMessages(ctx: ConvexMutationCtx, userId: string) {
	return ctx.db
		.query('messages')
		.withIndex('by_user_and_settled', (q) => q.eq('userId', userId).gte('quotaSettledAt', 0));
}

function supportContacts(ctx: ConvexMutationCtx, userId: string) {
	return ctx.db
		.query('supportThreads')
		.withIndex('by_user_and_first_user_message', (q) =>
			q.eq('userId', userId).gte('firstUserMessageAt', 0)
		);
}

const STEPS = {
	// Progress by deletion, after cancelling what each row still has queued.
	// The rows' unsent emails are cancelled in one child mutation, whose
	// failure fails the page.
	ledger: {
		paginates: false,
		run: (userId) =>
			Effect.gen(function* () {
				const rows = yield* withCtx((ctx) => notificationRows(ctx, userId).take(LEDGER_PAGE.rows));
				if (rows.length === 0) return EMPTY;
				const erased: typeof rows = [];
				const emailIds: string[] = [];
				for (const [index, row] of rows.entries()) {
					const ids = row.emailIds ?? [];
					if (index > 0 && emailIds.length + ids.length > LEDGER_PAGE.emailIds) break;
					erased.push(row);
					emailIds.push(...ids);
				}
				if (emailIds.length > 0) {
					yield* withCtx(async (ctx): Promise<void> => {
						await ctx.runMutation(internal.admin.customerNotifications.cancel.cancelUnsentEmails, {
							emailIds
						});
					});
				}
				for (const row of erased) {
					yield* cancelPendingSend(row);
					yield* withCtx((ctx) => ctx.db.delete('customerNotifications', row._id));
				}
				return erased.length < rows.length || rows.length === LEDGER_PAGE.rows
					? PROGRESS
					: FINISHED;
			}),
		probe: (userId) =>
			withCtx(async (ctx) => (await notificationRows(ctx, userId).first()) !== null)
	},
	// Progress by deletion.
	receipts: {
		paginates: false,
		run: (userId) =>
			Effect.gen(function* () {
				const receipts = yield* withCtx((ctx) =>
					ctx.db
						.query('aiChatMessageReceipts')
						.withIndex('by_user', (q) => q.eq('userId', userId))
						.take(RECEIPTS_PER_PAGE)
				);
				if (receipts.length === 0) return EMPTY;
				yield* withCtx(async (ctx) => {
					for (const receipt of receipts) {
						await ctx.db.delete('aiChatMessageReceipts', receipt._id);
					}
				});
				return receipts.length < RECEIPTS_PER_PAGE ? FINISHED : PROGRESS;
			}),
		probe: (userId) =>
			withCtx(async (ctx) => {
				const receipt = await ctx.db
					.query('aiChatMessageReceipts')
					.withIndex('by_user', (q) => q.eq('userId', userId))
					.first();
				return receipt !== null;
			})
	},
	// Messages stay; only their settlement marker is cleared, which moves them
	// out of the settled range. Every page starts again from the front, so an
	// unmarked history is never scanned and never scheduled.
	community: {
		paginates: true,
		run: (userId) =>
			Effect.gen(function* () {
				const page = yield* withCtx((ctx) =>
					settledMessages(ctx, userId).paginate({ cursor: null, ...COMMUNITY_PAGE })
				);
				if (page.page.length === 0) {
					if (page.isDone) return EMPTY;
					return yield* noProgress;
				}
				yield* withCtx(async (ctx) => {
					for (const message of page.page) {
						await ctx.db.patch('messages', message._id, { quotaSettledAt: undefined });
					}
				});
				return page.isDone ? FINISHED : PROGRESS;
			}),
		probe: (userId) => withCtx(async (ctx) => (await settledMessages(ctx, userId).first()) !== null)
	},
	// Threads stay; their first-contact time is cleared, which moves them out of
	// the range. Every page starts again from the front. The byte bound makes a
	// page of large threads shorter instead of failing it.
	support: {
		paginates: true,
		run: (userId) =>
			Effect.gen(function* () {
				const page = yield* withCtx((ctx) =>
					supportContacts(ctx, userId).paginate({ cursor: null, ...SUPPORT_PAGE })
				);
				if (page.page.length === 0) {
					if (page.isDone) return EMPTY;
					// Restarting from the front would read the same nothing again.
					return yield* noProgress;
				}
				yield* withCtx(async (ctx) => {
					for (const thread of page.page) {
						await ctx.db.patch('supportThreads', thread._id, { firstUserMessageAt: undefined });
					}
				});
				return page.isDone ? FINISHED : PROGRESS;
			}),
		probe: (userId) => withCtx(async (ctx) => (await supportContacts(ctx, userId).first()) !== null)
	}
} satisfies Record<ErasureStep, StepDefinition>;

const nextStepWithWork = (userId: string, from: number) =>
	Effect.gen(function* () {
		for (const step of ERASURE_ORDER.slice(from)) {
			if (yield* STEPS[step].probe(userId)) return { step };
		}
		return null;
	});

/**
 * One page of erasure, starting at `step`. Returns where the next page starts,
 * or null when nothing is left. Always run through `runErasurePage`, which
 * applies the page limits.
 */
export const eraseJourneyPage = ({ userId, step, cursor }: typeof ErasurePageArgsSchema.Type) =>
	Effect.gen(function* () {
		const start = ERASURE_ORDER.indexOf(step);
		let paginated = false;
		for (const [offset, current] of ERASURE_ORDER.slice(start).entries()) {
			const index = start + offset;
			const definition: StepDefinition = STEPS[current];
			if (definition.paginates && paginated) {
				// A second .paginate in this function would fail, so a later page
				// takes over, and only when this step has something to do.
				return yield* nextStepWithWork(userId, index);
			}
			const outcome = yield* definition.run(userId, offset === 0 ? cursor : undefined);
			paginated ||= definition.paginates;
			if (outcome.kind === 'empty') continue;
			if (outcome.kind === 'progress' && (yield* definition.probe(userId))) {
				const next: Continuation = { step: current, cursor: outcome.cursor };
				return next;
			}
			return yield* nextStepWithWork(userId, index + 1);
		}
		return null;
	});

/**
 * Run one page as a caught child transaction, then schedule what follows: the
 * next page on success, the next attempt after a failure, or nothing. A page
 * that still fails on its last attempt logs `journey_erasure_blocked` and
 * leaves its rows in place, so rerunning `continueErasure` for the user after
 * the cause is fixed resumes it.
 */
export async function runErasurePage(
	ctx: ConvexMutationCtx,
	run: typeof ErasureRunSchema.Type
): Promise<void> {
	const { userId, step, cursor, attempt } = run;
	let next: Continuation | null;
	try {
		next = await ctx.runMutation(
			internal.admin.journey.erasure.erasePage,
			{ userId, step, cursor },
			{ transactionLimits: ERASURE_PAGE_LIMITS }
		);
	} catch {
		const delay = RETRY_DELAYS_MS[attempt - 1];
		if (delay === undefined) {
			console.error({ code: 'journey_erasure_blocked', step, userId });
			return;
		}
		await ctx.scheduler.runAfter(delay, internal.admin.journey.erasure.continueErasure, {
			...run,
			attempt: attempt + 1
		});
		return;
	}
	if (next) {
		await ctx.scheduler.runAfter(0, internal.admin.journey.erasure.continueErasure, {
			userId,
			...next,
			attempt: 1
		});
	}
}

/**
 * Start erasure from the account deletion trigger. The first page is attempt
 * 1 and runs as a caught child, so its failure never blocks the deletion.
 */
export async function startJourneyErasure(ctx: ConvexMutationCtx, userId: string): Promise<void> {
	await runErasurePage(ctx, { userId, step: ERASURE_ORDER[0], attempt: 1 });
}
