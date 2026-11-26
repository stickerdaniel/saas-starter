import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ownership', () => ({
	getSupportOwnerIdentity: vi.fn()
}));

import { getSupportOwnerIdentity } from '../ownership';
import { hasUnreadAdminReply, unreadAdminReplyCount } from '../../../convex/support/readState';

const getOwnerMock = getSupportOwnerIdentity as unknown as ReturnType<typeof vi.fn>;

type Fn<A, R> = { _handler: (ctx: unknown, args: A) => Promise<R> };

const unreadHandler = hasUnreadAdminReply as unknown as Fn<{ anonymousUserId?: string }, boolean>;
const countHandler = unreadAdminReplyCount as unknown as Fn<{ anonymousUserId?: string }, number>;

describe('support human-reply read state', () => {
	beforeEach(() => {
		vi.clearAllMocks();
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

	it('sums unread messages and treats a legacy unread thread as one', async () => {
		getOwnerMock.mockResolvedValue({ ownerId: 'anon_owner', isAnonymous: true });
		const take = vi
			.fn()
			.mockResolvedValue([{ _id: 'support_1', unreadAdminReplyCount: 3 }, { _id: 'support_2' }]);
		const withIndex = vi.fn().mockReturnValue({ take });
		const ctx = { db: { query: vi.fn(() => ({ withIndex })) } };

		await expect(countHandler._handler(ctx, { anonymousUserId: 'anon_owner' })).resolves.toBe(4);
		expect(take).toHaveBeenCalledWith(10);
	});
});
