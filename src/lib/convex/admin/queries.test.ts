import { describe, expect, it, vi } from 'vitest';
import type { QueryCtx } from '../_generated/server';
import { countUsersWithFilters, getRecentDashboardMetrics } from './queries';

describe('admin query helpers', () => {
	it('counts every indexed user page without loading full documents', async () => {
		const runQuery = vi.fn(
			async (_reference: unknown, args: { paginationOpts: { cursor: string | null } }) => {
				if (!args.paginationOpts.cursor) {
					return { page: [{ _id: 'a' }, { _id: 'b' }], continueCursor: 'next', isDone: false };
				}
				return { page: [{ _id: 'c' }], continueCursor: '', isDone: true };
			}
		);
		const ctx = { runQuery } as unknown as QueryCtx;

		await expect(
			countUsersWithFilters(ctx, [{ field: 'role', operator: 'eq', value: 'admin' }])
		).resolves.toBe(3);
		expect(runQuery).toHaveBeenCalledTimes(2);
		expect(runQuery.mock.calls[0]?.[1]).toMatchObject({
			model: 'user',
			select: ['id'],
			where: [{ field: 'role', operator: 'eq', value: 'admin' }]
		});
	});

	it('deduplicates active users and stops signup reads at the recency cutoff', async () => {
		const oneDayAgo = 10_000;
		const sevenDaysAgo = 5_000;
		const runQuery = vi.fn(
			async (
				_reference: unknown,
				args: { model: string; paginationOpts: { cursor: string | null } }
			) => {
				if (args.model === 'session') {
					if (!args.paginationOpts.cursor) {
						return {
							page: [{ userId: 'user-a' }, { userId: 'user-b' }],
							continueCursor: 'sessions-next',
							isDone: false
						};
					}
					return { page: [{ userId: 'user-a' }], continueCursor: '', isDone: true };
				}

				return {
					page: [
						{ _id: 'new', createdAt: 6_000 },
						{ _id: 'old', createdAt: 4_000 }
					],
					continueCursor: 'users-next',
					isDone: false
				};
			}
		);
		const ctx = { runQuery } as unknown as QueryCtx;

		await expect(getRecentDashboardMetrics(ctx, oneDayAgo, sevenDaysAgo)).resolves.toEqual({
			activeIn24h: 2,
			recentSignups: 1
		});

		const userCalls = runQuery.mock.calls.filter(([, args]) => args.model === 'user');
		expect(userCalls).toHaveLength(1);
		expect(userCalls[0]?.[1]).toMatchObject({
			sortBy: { field: 'createdAt', direction: 'desc' },
			select: ['id', 'createdAt']
		});
	});
});
