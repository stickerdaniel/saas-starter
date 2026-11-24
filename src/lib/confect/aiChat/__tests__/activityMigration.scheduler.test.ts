// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { internal } from '../../../convex/_generated/api';
import schema from '../../../convex/schema';
import { convexModules } from '../../convexTest.modules';

const MAX_SCHEDULER_ITERATIONS = 10;
const PAGE_DELAY_MS = 250;
const NOW = Date.UTC(2026, 0, 1);

async function seeded(count: number) {
	const t = convexTest(schema, convexModules);
	await t.run(async (ctx) => {
		for (let i = 0; i < count; i++) {
			await ctx.db.insert('aiChatThreads', {
				threadId: `thread-${i}`,
				userId: 'user_1',
				createdAt: i,
				lastMessageAt: i + 1
			});
		}
	});
	return t;
}

const migration = (t: Awaited<ReturnType<typeof seeded>>) =>
	t.run(async (ctx) => {
		const state = await ctx.db.query('aiChatHistoryMigration').unique();
		const job = state?.scheduledFnId ? await ctx.db.system.get(state.scheduledFnId) : null;
		return { state, job };
	});

describe('aiChat/activityMigration on the scheduler', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('schedules the first page and backfills every row across pages', async () => {
		const t = await seeded(150);
		await expect(t.mutation(internal.aiChat.activityMigration.start, {})).resolves.toEqual({
			version: 1,
			status: 'running',
			processed: 0
		});
		const { job } = await migration(t);
		expect(job).toMatchObject({
			name: 'aiChat/activityMigration:runPage',
			args: [{ cursor: null }],
			scheduledTime: NOW + PAGE_DELAY_MS,
			state: { kind: 'pending' }
		});

		await t.finishAllScheduledFunctions(vi.runAllTimers, MAX_SCHEDULER_ITERATIONS);

		await expect(t.query(internal.aiChat.activityMigration.status, {})).resolves.toEqual({
			version: 1,
			status: 'complete',
			processed: 150
		});
		const rows = await t.run(async (ctx) => await ctx.db.query('aiChatThreads').take(200));
		expect(rows.map((row) => row.sidebarActivityAt)).toEqual(rows.map((row) => row.lastMessageAt));
		expect(rows).toHaveLength(150);
		expect((await migration(t)).state?.scheduledFnId).toBeUndefined();
	});

	it('reschedules a running migration whose job is gone from its checkpoint', async () => {
		const t = await seeded(150);
		await t.mutation(internal.aiChat.activityMigration.start, {});
		const first = await migration(t);
		await t.run(async (ctx) => {
			if (first.state?.scheduledFnId) await ctx.scheduler.cancel(first.state.scheduledFnId);
		});
		vi.setSystemTime(NOW + 1000);

		await t.mutation(internal.aiChat.activityMigration.start, {});

		const { state, job } = await migration(t);
		expect(state?.scheduledFnId).not.toBe(first.state?.scheduledFnId);
		expect(job).toMatchObject({
			name: 'aiChat/activityMigration:runPage',
			args: [{ id: state?._id, cursor: null }],
			scheduledTime: NOW + 1000 + PAGE_DELAY_MS,
			state: { kind: 'pending' }
		});
	});

	it('keeps a live job instead of scheduling a second one', async () => {
		const t = await seeded(1);
		await t.mutation(internal.aiChat.activityMigration.start, {});
		const first = await migration(t);
		await t.mutation(internal.aiChat.activityMigration.start, {});
		const second = await migration(t);
		expect(second.state?.scheduledFnId).toBe(first.state?.scheduledFnId);
		const pending = await t.run(
			async (ctx) => await ctx.db.system.query('_scheduled_functions').collect()
		);
		expect(pending).toHaveLength(1);
	});
});
