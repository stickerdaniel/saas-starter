import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ownership', () => ({
	getSupportOwnerIdentity: vi.fn(),
	requireSupportThreadRecord: vi.fn()
}));

import { getSupportOwnerIdentity, requireSupportThreadRecord } from '../ownership';
import { hasUnreadAdminReply, markThreadRead } from '../readState';

const getOwnerMock = getSupportOwnerIdentity as unknown as ReturnType<typeof vi.fn>;
const requireThreadMock = requireSupportThreadRecord as unknown as ReturnType<typeof vi.fn>;

type Fn<A, R> = { _handler: (ctx: unknown, args: A) => Promise<R> };

const unreadHandler = hasUnreadAdminReply as unknown as Fn<{ anonymousUserId?: string }, boolean>;
const markReadHandler = markThreadRead as unknown as Fn<
	{ threadId: string; anonymousUserId?: string },
	null
>;

describe('support human-reply read state', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns false without an authenticated or anonymous owner', async () => {
		getOwnerMock.mockResolvedValue(null);
		const ctx = { db: { query: vi.fn() } };

		await expect(unreadHandler._handler(ctx, {})).resolves.toBe(false);
		expect(ctx.db.query).not.toHaveBeenCalled();
	});

	it('uses the owner and unread index for the launcher signal', async () => {
		getOwnerMock.mockResolvedValue({ ownerId: 'anon_owner', isAnonymous: true });
		const first = vi.fn().mockResolvedValue({ _id: 'support_1' });
		const withIndex = vi.fn((_name, configure) => {
			const eq = vi.fn().mockReturnThis();
			configure({ eq });
			expect(eq).toHaveBeenNthCalledWith(1, 'userId', 'anon_owner');
			expect(eq).toHaveBeenNthCalledWith(2, 'hasUnreadAdminReply', true);
			return { first };
		});
		const ctx = { db: { query: vi.fn(() => ({ withIndex })) } };

		await expect(unreadHandler._handler(ctx, { anonymousUserId: 'anon_owner' })).resolves.toBe(
			true
		);
		expect(withIndex).toHaveBeenCalledWith('by_user_and_unread_admin_reply', expect.any(Function));
	});

	it('records the read timestamp without reordering the thread', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-09T12:00:00Z'));
		requireThreadMock.mockResolvedValue({
			supportThread: {
				_id: 'support_1',
				lastAdminReplyAt: Date.now() - 1000,
				hasUnreadAdminReply: true
			}
		});
		const ctx = { db: { patch: vi.fn() } };

		await markReadHandler._handler(ctx, {
			threadId: 'thread_1',
			anonymousUserId: 'anon_owner'
		});

		expect(requireThreadMock).toHaveBeenCalledWith(ctx, {
			threadId: 'thread_1',
			anonymousUserId: 'anon_owner'
		});
		expect(ctx.db.patch).toHaveBeenCalledWith('support_1', {
			userReadAt: Date.now(),
			hasUnreadAdminReply: false
		});
		expect(ctx.db.patch.mock.calls[0][1]).not.toHaveProperty('updatedAt');
	});

	it('does not rewrite a receipt that already covers the latest reply', async () => {
		requireThreadMock.mockResolvedValue({
			supportThread: {
				_id: 'support_1',
				lastAdminReplyAt: 100,
				userReadAt: 101,
				hasUnreadAdminReply: false
			}
		});
		const ctx = { db: { patch: vi.fn() } };

		await expect(markReadHandler._handler(ctx, { threadId: 'thread_1' })).resolves.toBeNull();
		expect(ctx.db.patch).not.toHaveBeenCalled();
	});
});
