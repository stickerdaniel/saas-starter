// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import agentSchema from '../../../../../node_modules/@convex-dev/agent/dist/component/schema.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { components, internal } from '../../_generated/api';
import schema from '../../schema';
import { supportAgent } from '../agent';

const DAY = 24 * 60 * 60 * 1000;
const SWEEP = 'support/threads:deleteEmptyThreads';

// Keys relative to the Convex root, which is where convex-test looks for `_generated`.
const modules = Object.fromEntries(
	Object.entries(import.meta.glob('../../**/*.ts')).map(([path, loader]) => [
		`.${new URL(path, 'file:///convex/support/__tests__/').pathname.slice('/convex'.length)}`,
		loader
	])
);
const agentModules = import.meta.glob(
	'../../../../../node_modules/@convex-dev/agent/dist/component/**/*.js'
);

function createHarness() {
	const t = convexTest(schema, modules);
	t.registerComponent('agent', agentSchema, agentModules);
	return t;
}

type Harness = ReturnType<typeof createHarness>;

/** Inserts support threads backed by real agent threads, `withMessage` ones holding one message. */
async function seedThreads(t: Harness, threads: Array<{ withMessage: boolean }>) {
	return await t.run(async (ctx) => {
		const seeded = [];
		for (const { withMessage } of threads) {
			const { _id: threadId } = await ctx.runMutation(components.agent.threads.createThread, {});
			if (withMessage) {
				await ctx.runMutation(components.agent.messages.addMessages, {
					threadId,
					messages: [{ message: { role: 'user', content: 'Hello' } }]
				});
			}
			const id = await ctx.db.insert('supportThreads', {
				threadId,
				userId: 'user_1',
				status: 'open',
				createdAt: Date.now(),
				updatedAt: Date.now()
			});
			seeded.push({ id, threadId });
		}
		return seeded;
	});
}

/** Starts the sweep the way the cron does, then runs every continuation it schedules. */
async function runCron(t: Harness, starts = 1) {
	for (let i = 0; i < starts; i++)
		await t.mutation(internal.support.threads.deleteEmptyThreads, {});
	await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function snapshot(t: Harness) {
	return await t.run(async (ctx) => ({
		rows: await ctx.db.query('supportThreads').take(500),
		continuations: (await ctx.db.system.query('_scheduled_functions').take(500)).filter(
			(job) => job.name === SWEEP
		).length
	}));
}

/** Makes deletion throw for the given agent threads, at most `times` times in total. */
function failDeletion(seeded: Array<{ threadId: string }>, times = Infinity) {
	const failing = new Set(seeded.map(({ threadId }) => threadId));
	const original = supportAgent.deleteThreadAsync.bind(supportAgent);
	let failures = 0;
	vi.spyOn(supportAgent, 'deleteThreadAsync').mockImplementation(async (ctx, args) => {
		if (failing.has(args.threadId) && failures < times) {
			failures++;
			throw new Error('Deletion unavailable');
		}
		return await original(ctx, args);
	});
}

describe('deleteEmptyThreads', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('deletes an old empty thread behind a full page of threads with messages', async () => {
		const t = createHarness();
		const used = await seedThreads(
			t,
			Array.from({ length: 100 }, () => ({ withMessage: true }))
		);
		const [empty] = await seedThreads(t, [{ withMessage: false }]);
		vi.advanceTimersByTime(DAY + 1);

		await runCron(t);

		const { rows } = await snapshot(t);
		expect(rows.find((row) => row._id === empty.id)).toBeUndefined();
		expect(rows.map((row) => row._id)).toEqual(used.map(({ id }) => id));
		expect(rows.every((row) => row.sweep === 'retained')).toBe(true);
	});

	it('moves past threads whose deletion keeps failing', async () => {
		const t = createHarness();
		const failing = await seedThreads(
			t,
			Array.from({ length: 25 }, () => ({ withMessage: false }))
		);
		const [later] = await seedThreads(t, [{ withMessage: false }]);
		vi.advanceTimersByTime(DAY + 1);
		failDeletion(failing);

		await runCron(t);

		const { rows } = await snapshot(t);
		expect(rows.find((row) => row._id === later.id)).toBeUndefined();
		expect(rows.map((row) => [row._id, row.sweep])).toEqual(
			failing.map(({ id }) => [id, 'failed'])
		);
	});

	it('moves past a thread whose messages cannot be read', async () => {
		const t = createHarness();
		const unreadable = await t.run(
			async (ctx) =>
				await ctx.db.insert('supportThreads', {
					threadId: 'not-an-agent-thread',
					userId: 'user_1',
					status: 'open',
					createdAt: Date.now(),
					updatedAt: Date.now()
				})
		);
		const [later] = await seedThreads(t, [{ withMessage: false }]);
		vi.advanceTimersByTime(DAY + 1);

		await runCron(t);

		const { rows } = await snapshot(t);
		expect(rows.find((row) => row._id === later.id)).toBeUndefined();
		expect(rows.map((row) => [row._id, row.sweep])).toEqual([[unreadable, 'failed']]);
	});

	it('retries a failed deletion on the next cron run', async () => {
		const t = createHarness();
		const [flaky] = await seedThreads(t, [{ withMessage: false }]);
		vi.advanceTimersByTime(DAY + 1);
		failDeletion([flaky], 1);

		await runCron(t);
		expect((await snapshot(t)).rows.map((row) => row.sweep)).toEqual(['failed']);

		await runCron(t);
		expect((await snapshot(t)).rows).toEqual([]);
	});

	it('retries a later failure behind failures that keep failing', async () => {
		const t = createHarness();
		const broken = await seedThreads(
			t,
			Array.from({ length: 25 }, () => ({ withMessage: false }))
		);
		const [flaky] = await seedThreads(t, [{ withMessage: false }]);
		vi.advanceTimersByTime(DAY + 1);
		const alwaysFailing = new Set(broken.map(({ threadId }) => threadId));
		const original = supportAgent.deleteThreadAsync.bind(supportAgent);
		let flakyFailed = false;
		vi.spyOn(supportAgent, 'deleteThreadAsync').mockImplementation(async (ctx, args) => {
			const failsNow =
				alwaysFailing.has(args.threadId) || (args.threadId === flaky.threadId && !flakyFailed);
			if (args.threadId === flaky.threadId) flakyFailed = true;
			if (failsNow) throw new Error('Deletion unavailable');
			return await original(ctx, args);
		});

		// Run 1 fails all 26; run 2 retries the 25 that failed first; run 3 reaches the flaky one.
		for (let run = 0; run < 3; run++) {
			await runCron(t);
			vi.advanceTimersByTime(1000);
		}

		const { rows } = await snapshot(t);
		expect(rows.find((row) => row._id === flaky.id)).toBeUndefined();
		expect(rows.map((row) => row._id)).toEqual(broken.map(({ id }) => id));
	});

	it('bounds two queued sweep chains to one continuation per full page', async () => {
		const t = createHarness();
		const used = await seedThreads(
			t,
			Array.from({ length: 40 }, () => ({ withMessage: true }))
		);
		await seedThreads(
			t,
			Array.from({ length: 20 }, () => ({ withMessage: false }))
		);
		vi.advanceTimersByTime(DAY + 1);

		await runCron(t, 2);

		const { rows, continuations } = await snapshot(t);
		expect(rows.map((row) => [row._id, row.sweep])).toEqual(used.map(({ id }) => [id, 'retained']));
		// Only a full page schedules a follow-up, and each consumes 25 of the 60 candidates.
		expect(continuations).toBeLessThanOrEqual(Math.floor(60 / 25));
	});

	it('writes and schedules nothing without candidates', async () => {
		const t = createHarness();
		await seedThreads(t, [{ withMessage: false }]);
		const before = await snapshot(t);

		const result = await t.mutation(internal.support.threads.deleteEmptyThreads, {});

		expect(result).toEqual({
			scanned: 0,
			retained: 0,
			deletionsStarted: 0,
			failed: 0,
			requeued: 0
		});
		expect(await snapshot(t)).toEqual(before);
		expect(before.continuations).toBe(0);
	});
});
