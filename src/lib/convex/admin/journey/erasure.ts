import { v, type Infer } from 'convex/values';
import { internal } from '../../_generated/api';
import { internalMutation, type MutationCtx } from '../../_generated/server';

/**
 * Erase the journey facts of a deleted user, in bounded pages.
 *
 * The account deletion trigger runs the first page (`startJourneyErasure`);
 * `continueErasure` runs every later one. Each page does real work in at most
 * one step and hands over through steps that have nothing to do, so no page is
 * ever scheduled for an empty step. The records themselves (community
 * messages, support threads) outlive the user; only the facts this feature
 * added are removed or cleared.
 */

const erasureStep = v.union(v.literal('receipts'), v.literal('community'), v.literal('support'));
type ErasureStep = Infer<typeof erasureStep>;

/** Steps run in this order. */
const ERASURE_ORDER: ErasureStep[] = erasureStep.members.map((member) => member.value);

const continuation = v.object({ step: erasureStep, cursor: v.optional(v.string()) });
type Continuation = Infer<typeof continuation>;

const MiB = 1024 * 1024;

/** Every page runs as a child transaction under these limits. */
const ERASURE_PAGE_LIMITS = { documentsRead: 2000, bytesRead: 4 * MiB, documentsWritten: 600 };

/** Delay before attempts 2, 3 and 4 of a failed page; attempt 4 is the last. */
const RETRY_DELAYS_MS = [60_000, 10 * 60_000, 60 * 60_000];

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

type StepDefinition = {
	/** Whether `run` calls `.paginate`, which Convex allows once per function. */
	paginates: boolean;
	run(ctx: MutationCtx, userId: string, cursor: string | undefined): Promise<StepOutcome>;
	/** Bounded check for whether a page of this step could find anything. */
	probe(ctx: MutationCtx, userId: string): Promise<boolean>;
};

function settledMessages(ctx: MutationCtx, userId: string) {
	return ctx.db
		.query('messages')
		.withIndex('by_user_and_settled', (q) => q.eq('userId', userId).gte('quotaSettledAt', 0));
}

function supportContacts(ctx: MutationCtx, userId: string) {
	return ctx.db
		.query('supportThreads')
		.withIndex('by_user_and_first_user_message', (q) =>
			q.eq('userId', userId).gte('firstUserMessageAt', 0)
		);
}

const STEPS = {
	// Progress by deletion.
	receipts: {
		paginates: false,
		async run(ctx, userId) {
			const receipts = await ctx.db
				.query('aiChatMessageReceipts')
				.withIndex('by_user', (q) => q.eq('userId', userId))
				.take(RECEIPTS_PER_PAGE);
			if (receipts.length === 0) return { kind: 'empty' };
			for (const receipt of receipts) {
				await ctx.db.delete('aiChatMessageReceipts', receipt._id);
			}
			return receipts.length < RECEIPTS_PER_PAGE ? { kind: 'finished' } : { kind: 'progress' };
		},
		async probe(ctx, userId) {
			const receipt = await ctx.db
				.query('aiChatMessageReceipts')
				.withIndex('by_user', (q) => q.eq('userId', userId))
				.first();
			return receipt !== null;
		}
	},
	// Messages stay; only their settlement marker is cleared, which moves them
	// out of the settled range. Every page starts again from the front, so an
	// unmarked history is never scanned and never scheduled.
	community: {
		paginates: true,
		async run(ctx, userId) {
			const page = await settledMessages(ctx, userId).paginate({
				cursor: null,
				...COMMUNITY_PAGE
			});
			if (page.page.length === 0) {
				if (page.isDone) return { kind: 'empty' };
				throw new Error('journey_erasure_no_progress');
			}
			for (const message of page.page) {
				await ctx.db.patch('messages', message._id, { quotaSettledAt: undefined });
			}
			return page.isDone ? { kind: 'finished' } : { kind: 'progress' };
		},
		async probe(ctx, userId) {
			return (await settledMessages(ctx, userId).first()) !== null;
		}
	},
	// Threads stay; their first-contact time is cleared, which moves them out of
	// the range. Every page starts again from the front. The byte bound makes a
	// page of large threads shorter instead of failing it.
	support: {
		paginates: true,
		async run(ctx, userId) {
			const page = await supportContacts(ctx, userId).paginate({ cursor: null, ...SUPPORT_PAGE });
			if (page.page.length === 0) {
				if (page.isDone) return { kind: 'empty' };
				// Restarting from the front would read the same nothing again.
				throw new Error('journey_erasure_no_progress');
			}
			for (const thread of page.page) {
				await ctx.db.patch('supportThreads', thread._id, { firstUserMessageAt: undefined });
			}
			return page.isDone ? { kind: 'finished' } : { kind: 'progress' };
		},
		async probe(ctx, userId) {
			return (await supportContacts(ctx, userId).first()) !== null;
		}
	}
} satisfies Record<ErasureStep, StepDefinition>;

async function nextStepWithWork(
	ctx: MutationCtx,
	userId: string,
	from: number
): Promise<Continuation | null> {
	for (const step of ERASURE_ORDER.slice(from)) {
		if (await STEPS[step].probe(ctx, userId)) return { step };
	}
	return null;
}

/**
 * One page of erasure, starting at `step`. Returns where the next page starts,
 * or null when nothing is left. Always run through `runErasurePage`, which
 * applies the page limits.
 */
export const erasePage = internalMutation({
	args: { userId: v.string(), step: erasureStep, cursor: v.optional(v.string()) },
	returns: v.union(continuation, v.null()),
	handler: async (ctx, { userId, step, cursor }) => {
		const start = ERASURE_ORDER.indexOf(step);
		let paginated = false;
		for (const [offset, current] of ERASURE_ORDER.slice(start).entries()) {
			const index = start + offset;
			const definition: StepDefinition = STEPS[current];
			if (definition.paginates && paginated) {
				// A second .paginate in this function would fail, so a later page
				// takes over, and only when this step has something to do.
				return await nextStepWithWork(ctx, userId, index);
			}
			const outcome = await definition.run(ctx, userId, offset === 0 ? cursor : undefined);
			paginated ||= definition.paginates;
			if (outcome.kind === 'empty') continue;
			if (outcome.kind === 'progress' && (await definition.probe(ctx, userId))) {
				return { step: current, cursor: outcome.cursor };
			}
			return await nextStepWithWork(ctx, userId, index + 1);
		}
		return null;
	}
});

type ErasureRun = Continuation & { userId: string; attempt: number };

/**
 * Run one page as a caught child transaction, then schedule what follows: the
 * next page on success, the next attempt after a failure, or nothing. A page
 * that still fails on its last attempt logs `journey_erasure_blocked` and
 * leaves its rows in place, so rerunning `continueErasure` for the user after
 * the cause is fixed resumes it.
 */
async function runErasurePage(ctx: MutationCtx, run: ErasureRun): Promise<void> {
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
export async function startJourneyErasure(ctx: MutationCtx, userId: string): Promise<void> {
	await runErasurePage(ctx, { userId, step: erasureStep.members[0].value, attempt: 1 });
}

export const continueErasure = internalMutation({
	args: {
		userId: v.string(),
		step: erasureStep,
		cursor: v.optional(v.string()),
		attempt: v.number()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await runErasurePage(ctx, args);
		return null;
	}
});
