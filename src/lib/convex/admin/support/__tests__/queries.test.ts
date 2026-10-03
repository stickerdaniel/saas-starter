import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../auth', () => ({
	authComponent: { getAuthUser: vi.fn(), safeGetAuthUser: vi.fn() }
}));
vi.mock('../../../_generated/api', () => ({
	components: { betterAuth: { adapter: {} }, agent: {} }
}));
vi.mock('@convex-dev/agent/validators', async () => {
	const { v } = await import('convex/values');
	return { vStreamArgs: v.optional(v.any()) };
});
vi.mock('../../../support/messageListing', () => ({ listMessagesForThread: vi.fn() }));

import { authComponent } from '../../../auth';
import { SUPPORT_MESSAGE_ROUTES_LIMIT } from '../constants';
import { listMessageRoutesForAdmin } from '../queries';

const getAuthUserMock = authComponent.getAuthUser as unknown as ReturnType<typeof vi.fn>;

type Fn<A, R> = { _handler: (ctx: unknown, args: A) => Promise<R> };
const routesHandler = listMessageRoutesForAdmin as unknown as Fn<
	{ threadId: string },
	Array<{ messageId: string; pageUrl: string }>
>;

function makeCtx(rows: Array<Record<string, unknown>>) {
	const take = vi.fn().mockResolvedValue(rows);
	const order = vi.fn(() => ({ take }));
	const withIndex = vi.fn(() => ({ order }));
	return { ctx: { db: { query: vi.fn(() => ({ withIndex })) } }, order, withIndex, take };
}

describe('listMessageRoutesForAdmin', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getAuthUserMock.mockResolvedValue({ _id: 'admin_1', role: 'admin' });
	});

	it('returns pathname-only routes and omits unsafe stored rows', async () => {
		const { ctx, withIndex, order, take } = makeCtx([
			{
				_id: 'row_3',
				threadId: 'thread_1',
				messageId: 'message_3',
				pageUrl: 'javascript:alert(1)'
			},
			{
				_id: 'row_2',
				threadId: 'thread_1',
				messageId: 'message_2',
				pageUrl: 'https://x/fr/two?tab=files#section'
			},
			{ _id: 'row_1', threadId: 'thread_1', messageId: 'message_1', pageUrl: '/de/one' }
		]);

		const result = await routesHandler._handler(ctx, { threadId: 'thread_1' });

		expect(result).toEqual([
			{ messageId: 'message_2', pageUrl: '/fr/two' },
			{ messageId: 'message_1', pageUrl: '/de/one' }
		]);
		expect(withIndex).toHaveBeenCalledWith('by_thread', expect.any(Function));
		// Newest first and bounded: a thread past the bound keeps the routes an
		// admin is looking at instead of the oldest ones.
		expect(order).toHaveBeenCalledWith('desc');
		expect(take).toHaveBeenCalledWith(SUPPORT_MESSAGE_ROUTES_LIMIT);
	});

	// Routes name the pages a customer was on, so the read stays with the team
	// that already holds the ticket.
	it('refuses a signed-in viewer who is not an admin', async () => {
		getAuthUserMock.mockResolvedValue({ _id: 'user_2', role: 'user' });
		const { ctx, take } = makeCtx([]);

		await expect(routesHandler._handler(ctx, { threadId: 'thread_1' })).rejects.toThrow();
		expect(take).not.toHaveBeenCalled();
	});
});
