// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import agentSchema from '../../../../../node_modules/@convex-dev/agent/dist/component/schema.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { components, internal } from '../../_generated/api';
import schema from '../../schema';
import { supportAgent } from '../agent';
import { EMPTY_THREAD_SWEEP_MAX_ATTEMPTS } from '../threadMaintenance';

const DAY = 24 * 60 * 60 * 1000;
const RETRY = 'support/threads:retryEmptyThreadSweep';

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

/** One cron run, then every retry and component job it scheduled, however far ahead. */
async function runCron(t: Harness) {
	const sweep = await t.mutation(internal.support.threads.deleteEmptyThreads, {});
	await t.finishAllScheduledFunctions(vi.runAllTimers);
	return sweep;
}

/** Runs the cron until a run finds no candidate, as successive cron ticks would. */
async function runCronUntilIdle(t: Harness) {
	let runs = 0;
	while ((await runCron(t)).scanned > 0) runs++;
	return runs;
}

async function snapshot(t: Harness) {
	return await t.run(async (ctx) => ({
		rows: await ctx.db.query('supportThreads').take(500),
		retries: (await ctx.db.system.query('_scheduled_functions').take(500)).filter(
			(job) => job.name === RETRY
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

	it('deletes an old empty thread behind threads with messages', async () => {
		const t = createHarness();
		const used = await seedThreads(
			t,
			Array.from({ length: 100 }, () => ({ withMessage: true }))
		);
		const [empty] = await seedThreads(t, [{ withMessage: false }]);
		vi.advanceTimersByTime(DAY + 1);

		expect(await runCronUntilIdle(t)).toBe(Math.ceil(101 / 8));

		const { rows } = await snapshot(t);
		expect(rows.find((row) => row._id === empty.id)).toBeUndefined();
		expect(rows.map((row) => row._id)).toEqual(used.map(({ id }) => id));
		expect(rows.every((row) => row.sweep === 'retained')).toBe(true);
	});

	it('keeps sweeping past threads whose deletion keeps failing, then gives up on them', async () => {
		const t = createHarness();
		const broken = await seedThreads(
			t,
			Array.from({ length: 8 }, () => ({ withMessage: false }))
		);
		const [later] = await seedThreads(t, [{ withMessage: false }]);
		vi.advanceTimersByTime(DAY + 1);
		failDeletion(broken);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await runCronUntilIdle(t);

		const { rows, retries } = await snapshot(t);
		expect(rows.find((row) => row._id === later.id)).toBeUndefined();
		expect(rows.map((row) => [row._id, row.sweep, row.sweepAttempts])).toEqual(
			broken.map(({ id }) => [id, 'failed', EMPTY_THREAD_SWEEP_MAX_ATTEMPTS])
		);
		// Every attempt but the last scheduled one retry; the last one logged instead.
		expect(retries).toBe(broken.length * (EMPTY_THREAD_SWEEP_MAX_ATTEMPTS - 1));
		expect(warn).toHaveBeenCalledTimes(broken.length);
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
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		await runCronUntilIdle(t);

		const { rows } = await snapshot(t);
		expect(rows.find((row) => row._id === later.id)).toBeUndefined();
		expect(rows.map((row) => [row._id, row.sweep])).toEqual([[unreadable, 'failed']]);
	});

	it('deletes a thread on the retry after a failed deletion', async () => {
		const t = createHarness();
		const [flaky] = await seedThreads(t, [{ withMessage: false }]);
		vi.advanceTimersByTime(DAY + 1);
		failDeletion([flaky], 1);

		await runCron(t);

		expect((await snapshot(t)).rows).toEqual([]);
	});

	it('ignores a retry that a newer failure has replaced', async () => {
		const t = createHarness();
		const [stuck] = await seedThreads(t, [{ withMessage: false }]);
		await t.run(async (ctx) => {
			await ctx.db.patch('supportThreads', stuck.id, { sweep: 'failed', sweepAttempts: 2 });
		});

		await t.mutation(internal.support.threads.retryEmptyThreadSweep, {
			supportThreadId: stuck.id,
			attempt: 1
		});

		const [row] = (await snapshot(t)).rows;
		expect([row?.sweep, row?.sweepAttempts]).toEqual(['failed', 2]);
	});

	it('writes and schedules nothing without candidates', async () => {
		const t = createHarness();
		await seedThreads(t, [{ withMessage: false }]);
		const before = await snapshot(t);

		const result = await t.mutation(internal.support.threads.deleteEmptyThreads, {});

		expect(result).toEqual({ scanned: 0, retained: 0, deletionsStarted: 0, failed: 0 });
		expect(await snapshot(t)).toEqual(before);
	});
});
