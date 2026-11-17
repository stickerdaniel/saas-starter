// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { components } from '../_generated/api';
import authSchema from '../betterAuth/schema';
import { convexModules, preloadModules } from '../convexTest.modules';
import schema from '../schema';
import { getCounters, incrementCounter, recalculateCounters } from './counters';

// convex-test runs transactions one at a time, so these tests check the data
// invariants of the sharded counters, not the absence of write conflicts.
const betterAuthModules = await preloadModules(import.meta.glob('../betterAuth/**/*.ts'));
const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	return t;
};

const zero = { totalUsers: 0, adminCount: 0, bannedCount: 0 };

describe('dashboard counters', () => {
	it('sums the legacy singleton and every shard', async () => {
		const t = harness();
		await t.run(async (ctx) => {
			await ctx.db.insert('dashboardCounters', { totalUsers: 5, adminCount: 1, bannedCount: 0 });
			for (let i = 0; i < 40; i++) await incrementCounter(ctx, 'totalUsers', 1);
			await incrementCounter(ctx, 'bannedCount', 1);
			await incrementCounter(ctx, 'adminCount', -1);

			expect(await getCounters(ctx)).toEqual({ totalUsers: 45, adminCount: 0, bannedCount: 1 });
			const rows = await ctx.db.query('dashboardCounters').take(100);
			const shards = rows.map((row) => row.shard).filter((shard) => shard !== undefined);
			expect(new Set(shards).size).toBe(shards.length);
			expect(shards.every((shard) => shard >= 0 && shard < 16)).toBe(true);
		});
	});

	it('reads zero before the first write', async () => {
		const t = harness();
		expect(await t.run((ctx) => getCounters(ctx))).toEqual(zero);
	});

	it('rejects a duplicate or out-of-range shard', async () => {
		const t = harness();
		await t.run(async (ctx) => {
			await ctx.db.insert('dashboardCounters', { ...zero, shard: 3 });
			await ctx.db.insert('dashboardCounters', { ...zero, shard: 3 });
			await expect(getCounters(ctx)).rejects.toThrow('malformed');
		});
		const other = harness();
		await other.run(async (ctx) => {
			await ctx.db.insert('dashboardCounters', { ...zero, shard: 16 });
			await expect(getCounters(ctx)).rejects.toThrow('malformed');
		});
	});

	it('recalculates from the users and rewrites every shard', async () => {
		const t = harness();
		const now = Date.now();
		for (const [email, role, banned] of [
			['a@example.com', 'admin', false],
			['b@example.com', 'user', true],
			['c@example.com', 'user', false]
		] as const) {
			await t.mutation(components.betterAuth.adapter.create, {
				input: {
					model: 'user',
					data: {
						name: email,
						email,
						role,
						banned,
						emailVerified: true,
						createdAt: now,
						updatedAt: now
					}
				}
			});
		}
		await t.run(async (ctx) => {
			await ctx.db.insert('dashboardCounters', { totalUsers: 99, adminCount: 9, bannedCount: 9 });
			await ctx.db.insert('dashboardCounters', { ...zero, shard: 4 });
			await ctx.db.insert('dashboardCounters', { ...zero, shard: 4 });

			const expected = { totalUsers: 3, adminCount: 1, bannedCount: 1 };
			expect(await recalculateCounters(ctx)).toEqual(expected);
			expect(await getCounters(ctx)).toEqual(expected);
			const rows = await ctx.db.query('dashboardCounters').take(100);
			expect(rows.map((row) => row.shard).sort((a, b) => a! - b!)).toEqual(
				Array.from({ length: 16 }, (_, i) => i)
			);
		});
	});

	it('refuses a repair that cannot delete every row', async () => {
		const t = harness();
		await t.run(async (ctx) => {
			await ctx.db.insert('dashboardCounters', { totalUsers: 7, adminCount: 0, bannedCount: 0 });
			for (let i = 0; i < 1000; i++)
				await ctx.db.insert('dashboardCounters', { ...zero, shard: 0 });
			await expect(recalculateCounters(ctx)).rejects.toThrow('more than 1000 rows');
		});
	});
});
