import { describe, expect, it, vi } from 'vitest';

vi.mock('../auth', () => ({
	authComponent: { getAuthUser: vi.fn().mockResolvedValue({ _id: 'viewer', role: 'admin' }) }
}));
vi.mock('../support/ownership', () => ({
	getSupportOwnerIdentity: vi.fn().mockResolvedValue({ ownerId: 'viewer', isAnonymous: false }),
	requireSupportOwnerIdentity: vi.fn(),
	requireSupportThreadAccess: vi.fn(),
	requireSupportThreadRecord: vi.fn()
}));
vi.mock('../support/agent', () => ({ supportAgent: {} }));

import { listAuditLogs } from '../admin/auditLog/queries';
import { listThreadsForAdmin } from '../admin/support/queries';
import { listThreads } from '../support/threads';

const users = [
	{ _id: 'a', name: 'Alice', email: 'alice@example.test', image: '/alice.png' },
	{ _id: 'b', name: 'Bob', email: 'bob@example.test', image: null }
];

function context(rows: unknown[]) {
	const paginate = async () => ({ page: rows, isDone: false, continueCursor: 'next' });
	const ordered = { order: () => ({ paginate }) };
	// The pinned adapter resolves `_id in` with point reads, omits missing users,
	// applies select, and returns all matches with isDone=true (adapter-utils.ts).
	const runQuery = vi.fn(
		async (
			_ref: unknown,
			args: {
				model: string;
				where: Array<{ field: string; operator?: string; value: string | string[] }>;
				select?: string[];
			}
		) => {
			expect(args.model).toBe('user');
			const condition = args.where[0]!;
			expect(condition.field).toBe('_id');
			const ids = Array.isArray(condition.value) ? condition.value : [condition.value];
			if (ids.includes('invalid')) throw new Error('Invalid legacy user ID');
			const page = users
				.filter((user) => ids.includes(user._id))
				.map((user) =>
					args.select
						? Object.fromEntries(Object.entries(user).filter(([key]) => args.select!.includes(key)))
						: user
				);
			return condition.operator === 'in'
				? { page, isDone: true, continueCursor: '' }
				: (page[0] ?? null);
		}
	);
	return { db: { query: () => ({ withIndex: () => ordered }) }, runQuery };
}

function invoke<T>(query: unknown, ctx: unknown, args: unknown): Promise<T> {
	return (query as { _handler: (ctx: unknown, args: unknown) => Promise<T> })._handler(ctx, args);
}

function thread(userId: string, assignedTo?: string) {
	return {
		threadId: `thread-${userId}-${assignedTo}`,
		userId,
		assignedTo,
		createdAt: 1,
		status: 'open'
	};
}

describe('bounded user enrichment', () => {
	it('resolves an audit page in one component call and preserves deleted-user references', async () => {
		const ctx = context([
			{ _id: 'log-1', adminUserId: 'a', targetUserId: 'b', action: 'set_role', timestamp: 1 },
			{ _id: 'log-2', adminUserId: 'a', targetUserId: 'deleted', action: 'ban_user', timestamp: 2 }
		]);
		const result = await invoke<{
			items: Array<{ admin: unknown; target: unknown }>;
			continueCursor: string;
		}>(listAuditLogs, ctx, { numItems: 20 });
		expect(result.items.map((row) => row.admin)).toEqual([
			{ id: 'a', name: 'Alice', email: 'alice@example.test', image: '/alice.png', exists: true },
			{ id: 'a', name: 'Alice', email: 'alice@example.test', image: '/alice.png', exists: true }
		]);
		expect(result.items[0]!.target).toEqual({
			id: 'b',
			name: 'Bob',
			email: 'bob@example.test',
			image: undefined,
			exists: true
		});
		expect(result.items[1]!.target).toEqual({ id: 'deleted', exists: false });
		expect(result.continueCursor).toBe('next');
		expect(ctx.runQuery).toHaveBeenCalledTimes(1);
	});

	it('resolves inbox avatars in one call without querying anonymous owners', async () => {
		const ctx = context(['a', 'a', 'b', 'deleted', 'anon_guest'].map((id) => thread(id)));
		const result = await invoke<{ page: Array<{ userId: string; userImage?: string }> }>(
			listThreadsForAdmin,
			ctx,
			{ filter: 'all' }
		);
		expect(result.page.map((row) => [row.userId, row.userImage])).toEqual([
			['a', '/alice.png'],
			['a', '/alice.png'],
			['b', undefined],
			['deleted', undefined],
			['anon_guest', undefined]
		]);
		expect(ctx.runQuery).toHaveBeenCalledTimes(1);
		expect(ctx.runQuery.mock.calls[0]![1].where[0]!.value).toEqual(['a', 'b', 'deleted']);
	});

	it('resolves assigned admins in one call and retains an absent assignment for deleted users', async () => {
		const ctx = context([
			thread('viewer', 'a'),
			thread('viewer', 'b'),
			thread('viewer', 'a'),
			thread('viewer', 'deleted')
		]);
		const result = await invoke<{
			page: Array<{ assignedAdmin?: { name?: string; image: string | null } }>;
		}>(listThreads, ctx, {});
		expect(result.page.map((row) => row.assignedAdmin)).toEqual([
			{ name: 'Alice', image: '/alice.png' },
			{ name: 'Bob', image: null },
			{ name: 'Alice', image: '/alice.png' },
			undefined
		]);
		expect(ctx.runQuery).toHaveBeenCalledTimes(1);
	});

	it('preserves valid assignments when a malformed legacy ID rejects a batch', async () => {
		const ctx = context([
			thread('viewer', 'a'),
			thread('viewer', 'invalid'),
			thread('viewer', 'b')
		]);
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		try {
			const result = await invoke<{
				page: Array<{ assignedAdmin?: { name?: string; image: string | null } }>;
			}>(listThreads, ctx, {});
			expect(result.page.map((row) => row.assignedAdmin)).toEqual([
				{ name: 'Alice', image: '/alice.png' },
				undefined,
				{ name: 'Bob', image: null }
			]);
		} finally {
			log.mockRestore();
		}
	});

	it.each([
		['audit', listAuditLogs, { numItems: 20 }],
		['admin inbox', listThreadsForAdmin, { filter: 'all' }],
		['customer inbox', listThreads, {}]
	])('skips user lookup for an empty %s page', async (_name, query, args) => {
		const ctx = context([]);
		await invoke(query, ctx, args);
		expect(ctx.runQuery).not.toHaveBeenCalled();
	});
});
