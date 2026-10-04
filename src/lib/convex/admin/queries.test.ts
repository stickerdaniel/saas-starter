import { describe, expect, it, vi } from 'vitest';

vi.mock('../auth', () => ({
	authComponent: { getAuthUser: vi.fn(async () => ({ _id: 'admin_1', role: 'admin' })) }
}));

import type { QueryCtx } from '../_generated/server';
import type { AdminUserData } from './types';
import {
	countUsersWithFilters,
	getRecentDashboardMetrics,
	listUsers,
	resolveUsersLastPage
} from './queries';

type Fn<A, R> = { _handler: (ctx: unknown, args: A) => Promise<R> };
type ListUsersArgs = {
	cursor?: string;
	numItems: number;
	search?: string;
	providerFilter?: 'credential' | 'google' | 'github' | 'passkey';
	sortBy?: { field: 'createdAt' | 'provider'; direction: 'asc' | 'desc' };
};
const listUsersHandler = (
	listUsers as unknown as Fn<
		ListUsersArgs,
		{ items: AdminUserData[]; continueCursor: string | null; isDone: boolean }
	>
)._handler;
const resolveUsersLastPageHandler = (
	resolveUsersLastPage as unknown as Fn<ListUsersArgs, { page: number; cursor: string | null }>
)._handler;

/**
 * An adapter double for the offset paths: every `user` read returns the whole
 * table in one done page, and `account` reads filter by provider or user ids.
 */
function offsetCtx() {
	const users = ['u1', 'u2', 'u3', 'u4', 'u5'].map((id) => ({ _id: id, email: `${id}@x.test` }));
	const accounts = [
		{ userId: 'u1', providerId: 'github' },
		{ userId: 'u2', providerId: 'credential' },
		{ userId: 'u3', providerId: 'github' },
		{ userId: 'u4', providerId: 'google' },
		{ userId: 'u5', providerId: 'github' }
	];
	const runQuery = vi.fn(
		async (
			_reference: unknown,
			args: { model: string; where?: Array<{ field: string; value: unknown }> }
		) => {
			if (args.model === 'user') return { page: users, continueCursor: null, isDone: true };
			const where = args.where?.[0];
			const userIds = Array.isArray(where?.value) ? (where.value as string[]) : [];
			const page = accounts.filter((account) =>
				where?.field === 'providerId'
					? account.providerId === where.value
					: userIds.includes(account.userId)
			);
			return { page, continueCursor: null, isDone: true };
		}
	);
	return { runQuery };
}

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

describe('listUsers offset paths', () => {
	it('pages a provider filter by offset cursor', async () => {
		const ctx = offsetCtx();
		const first = await listUsersHandler(ctx, { numItems: 2, providerFilter: 'github' });
		expect(first.items.map((user) => user.id)).toEqual(['u1', 'u3']);
		expect(first).toMatchObject({ continueCursor: '2', isDone: false });

		const last = await listUsersHandler(ctx, {
			numItems: 2,
			providerFilter: 'github',
			cursor: first.continueCursor!
		});
		expect(last.items.map((user) => user.id)).toEqual(['u5']);
		expect(last).toMatchObject({ continueCursor: null, isDone: true });

		await expect(
			resolveUsersLastPageHandler(ctx, { numItems: 2, providerFilter: 'github' })
		).resolves.toEqual({ page: 2, cursor: '2' });
	});

	it('pages a provider sort by offset cursor', async () => {
		const ctx = offsetCtx();
		const sortBy = { field: 'provider', direction: 'asc' } as const;
		const first = await listUsersHandler(ctx, { numItems: 2, sortBy });
		expect(first.items.map((user) => user.providers)).toEqual([['credential'], ['github']]);
		expect(first).toMatchObject({ continueCursor: '2', isDone: false });

		const second = await listUsersHandler(ctx, { numItems: 2, sortBy, cursor: '2' });
		expect(second.items.map((user) => user.providers)).toEqual([['github'], ['github']]);
		expect(second).toMatchObject({ continueCursor: '4', isDone: false });

		const last = await listUsersHandler(ctx, { numItems: 2, sortBy, cursor: '4' });
		expect(last.items.map((user) => user.providers)).toEqual([['google']]);
		expect(last).toMatchObject({ continueCursor: null, isDone: true });
	});

	it('restarts a garbage offset cursor at the first page', async () => {
		const result = await listUsersHandler(offsetCtx(), {
			numItems: 2,
			providerFilter: 'github',
			cursor: 'garbage'
		});
		expect(result.items.map((user) => user.id)).toEqual(['u1', 'u3']);
	});
});

describe('listUsers adapter path', () => {
	function adapterCtx(page: { continueCursor: string | null; isDone: boolean }) {
		const runQuery = vi.fn(async (_reference: unknown, args: { model: string }) =>
			args.model === 'user'
				? { page: [{ _id: 'u1', email: 'u1@x.test' }], ...page }
				: { page: [], continueCursor: null, isDone: true }
		);
		return { runQuery };
	}

	it('drops the adapter cursor from its last page', async () => {
		const result = await listUsersHandler(
			adapterCtx({ continueCursor: 'adapter-end', isDone: true }),
			{ numItems: 10 }
		);
		expect(result).toMatchObject({ continueCursor: null, isDone: true });
		expect(result.items).toHaveLength(1);
	});

	it('keeps the adapter cursor on a pending page', async () => {
		const result = await listUsersHandler(
			adapterCtx({ continueCursor: 'adapter-next', isDone: false }),
			{ numItems: 10, cursor: 'adapter-prev' }
		);
		expect(result).toMatchObject({ continueCursor: 'adapter-next', isDone: false });
	});
});
