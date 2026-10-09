import { describe, expect, it, vi } from 'vitest';

vi.mock('../../auth', () => ({
	authComponent: { getAuthUser: vi.fn(async () => ({ _id: 'admin_1', role: 'admin' })) }
}));

import {
	listNotificationRecipients,
	resolveNotificationRecipientsLastPage,
	type NotificationRecipient
} from './queries';

type Fn<A, R> = { _handler: (ctx: unknown, args: A) => Promise<R> };
type ListArgs = { cursor?: string; numItems: number; typeFilter?: 'admin' | 'custom' };
const listHandler = (
	listNotificationRecipients as unknown as Fn<
		ListArgs,
		{ items: NotificationRecipient[]; continueCursor: string | null; isDone: boolean }
	>
)._handler;
const lastPageHandler = (
	resolveNotificationRecipientsLastPage as unknown as Fn<
		ListArgs,
		{ page: number; cursor: string | null }
	>
)._handler;

/**
 * Five custom recipients (no user id), created a..e, so the default sort is
 * e..a. None stores `notifyNewCustomers`, as rows from before that toggle;
 * `overrides` sets fields per letter.
 */
function recipientsCtx(overrides: Record<string, Record<string, unknown>> = {}) {
	const rows = ['a', 'b', 'c', 'd', 'e'].map((letter, index) => ({
		email: `${letter}@x.test`,
		isAdminUser: false,
		notifyNewSupportTickets: true,
		notifyUserReplies: true,
		notifyNewSignups: true,
		createdAt: index,
		updatedAt: index,
		...overrides[letter]
	}));
	return {
		db: { query: () => ({ collect: async () => rows }) },
		runQuery: async () => ({ page: [], continueCursor: null, isDone: true })
	};
}

describe('listNotificationRecipients', () => {
	it('pages the sorted recipients by offset cursor', async () => {
		const ctx = recipientsCtx();
		const first = await listHandler(ctx, { numItems: 2 });
		expect(first.items.map((row) => row.email)).toEqual(['e@x.test', 'd@x.test']);
		expect(first).toMatchObject({ continueCursor: '2', isDone: false });

		const second = await listHandler(ctx, { numItems: 2, cursor: first.continueCursor! });
		expect(second.items.map((row) => row.email)).toEqual(['c@x.test', 'b@x.test']);
		expect(second).toMatchObject({ continueCursor: '4', isDone: false });

		const last = await listHandler(ctx, { numItems: 2, cursor: second.continueCursor! });
		expect(last.items.map((row) => row.email)).toEqual(['a@x.test']);
		expect(last).toMatchObject({ continueCursor: null, isDone: true });
	});

	it('shows a toggle stored before it existed as on and an explicit false as off', async () => {
		const ctx = recipientsCtx({ a: { notifyNewCustomers: false } });

		const { items } = await listHandler(ctx, { numItems: 5 });

		expect(Object.fromEntries(items.map((row) => [row.email, row.notifyNewCustomers]))).toEqual({
			'a@x.test': false,
			'b@x.test': true,
			'c@x.test': true,
			'd@x.test': true,
			'e@x.test': true
		});
	});

	it('resolves the last page to the offset that fetches it', async () => {
		const ctx = recipientsCtx();
		await expect(lastPageHandler(ctx, { numItems: 2 })).resolves.toEqual({ page: 3, cursor: '4' });
		await expect(lastPageHandler(ctx, { numItems: 10 })).resolves.toEqual({
			page: 1,
			cursor: null
		});
		await expect(lastPageHandler(ctx, { numItems: 2, typeFilter: 'admin' })).resolves.toEqual({
			page: 1,
			cursor: null
		});
	});
});
