import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../auth', () => ({
	authComponent: {
		safeGetAuthUser: vi.fn()
	}
}));

vi.mock('../agent', () => ({
	supportAgent: {
		getThreadMetadata: vi.fn()
	}
}));

vi.mock('../../_generated/api', () => ({
	components: {
		agent: {
			messages: {
				getMessagesByIds: 'components.agent.messages.getMessagesByIds'
			}
		}
	}
}));

import {
	assertMessageOwnership,
	getSupportOwnerIdentity,
	requireSupportOwnerIdentity,
	requireSupportThreadAccess,
	requireSupportThreadRecord
} from '../ownership';
import { authComponent } from '../../auth';
import { supportAgent } from '../agent';

const safeGetAuthUserMock = authComponent.safeGetAuthUser as unknown as ReturnType<typeof vi.fn>;
const getThreadMetadataMock = supportAgent.getThreadMetadata as unknown as ReturnType<typeof vi.fn>;

function createCtx() {
	return {
		db: {
			query: vi.fn(() => ({
				withIndex: vi.fn(() => ({
					first: vi.fn()
				}))
			}))
		},
		runQuery: vi.fn()
	} as unknown as Parameters<typeof getSupportOwnerIdentity>[0];
}

describe('support ownership helpers', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('prefers authenticated ownership over anonymous proof', async () => {
		const ctx = createCtx();
		safeGetAuthUserMock.mockResolvedValue({ _id: 'auth_user_1' } as never);

		const result = await getSupportOwnerIdentity(ctx, 'anon_123');

		expect(result).toEqual({
			ownerId: 'auth_user_1',
			isAnonymous: false
		});
	});

	it('accepts a valid anonymous proof when unauthenticated', async () => {
		const ctx = createCtx();
		safeGetAuthUserMock.mockResolvedValue(undefined);

		const result = await getSupportOwnerIdentity(ctx, 'anon_123');

		expect(result).toEqual({
			ownerId: 'anon_123',
			anonymousUserId: 'anon_123',
			isAnonymous: true
		});
	});

	it('rejects missing or malformed anonymous proof when unauthenticated', async () => {
		const ctx = createCtx();
		safeGetAuthUserMock.mockResolvedValue(undefined);

		await expect(getSupportOwnerIdentity(ctx, undefined)).resolves.toBeNull();
		await expect(getSupportOwnerIdentity(ctx, 'user_123')).resolves.toBeNull();
	});

	it('throws when a caller has no authenticated or anonymous identity', async () => {
		const ctx = createCtx();
		safeGetAuthUserMock.mockResolvedValue(undefined);

		await expect(requireSupportOwnerIdentity(ctx, undefined)).rejects.toThrow(
			'Authentication required'
		);
	});

	it('allows an authenticated owner to access their own thread', async () => {
		const ctx = createCtx();
		safeGetAuthUserMock.mockResolvedValue({ _id: 'auth_user_1' } as never);
		const firstMock = vi.fn().mockResolvedValue({
			threadId: 'thread_1',
			userId: 'auth_user_1'
		});
		(
			ctx as unknown as {
				db: { query: ReturnType<typeof vi.fn> };
			}
		).db.query.mockReturnValue({
			withIndex: vi.fn(() => ({
				first: firstMock
			}))
		});
		getThreadMetadataMock.mockResolvedValue({
			threadId: 'thread_1',
			userId: 'auth_user_1'
		} as never);

		const result = await requireSupportThreadAccess(ctx, { threadId: 'thread_1' });

		expect(result.owner).toEqual({
			ownerId: 'auth_user_1',
			isAnonymous: false
		});
		expect(result.supportThread).toEqual({ threadId: 'thread_1', userId: 'auth_user_1' });
		expect(result.thread).toEqual({ threadId: 'thread_1', userId: 'auth_user_1' });
	});

	it('allows an anonymous owner with the matching proof token', async () => {
		const ctx = createCtx();
		safeGetAuthUserMock.mockResolvedValue(undefined);
		(
			ctx as unknown as {
				db: { query: ReturnType<typeof vi.fn> };
			}
		).db.query.mockReturnValue({
			withIndex: vi.fn(() => ({
				first: vi.fn().mockResolvedValue({
					threadId: 'thread_1',
					userId: 'anon_owner'
				})
			}))
		});
		getThreadMetadataMock.mockResolvedValue({
			threadId: 'thread_1',
			userId: 'anon_owner'
		} as never);

		const result = await requireSupportThreadAccess(ctx, {
			threadId: 'thread_1',
			anonymousUserId: 'anon_owner'
		});

		expect(result.owner).toEqual({
			ownerId: 'anon_owner',
			anonymousUserId: 'anon_owner',
			isAnonymous: true
		});
	});

	it('rejects non-owners for thread access', async () => {
		const ctx = createCtx();
		safeGetAuthUserMock.mockResolvedValue({ _id: 'auth_user_2' } as never);
		(
			ctx as unknown as {
				db: { query: ReturnType<typeof vi.fn> };
			}
		).db.query.mockReturnValue({
			withIndex: vi.fn(() => ({
				first: vi.fn().mockResolvedValue({
					threadId: 'thread_1',
					userId: 'auth_user_1'
				})
			}))
		});
		getThreadMetadataMock.mockResolvedValue({
			threadId: 'thread_1',
			userId: 'auth_user_1'
		} as never);

		await expect(requireSupportThreadAccess(ctx, { threadId: 'thread_1' })).rejects.toThrow(
			"Unauthorized: Cannot access another user's thread"
		);
	});

	it('rejects owned non-support threads before agent lookup', async () => {
		const ctx = createCtx();
		safeGetAuthUserMock.mockResolvedValue({ _id: 'auth_user_1' } as never);
		(
			ctx as unknown as {
				db: { query: ReturnType<typeof vi.fn> };
			}
		).db.query.mockReturnValue({
			withIndex: vi.fn(() => ({
				first: vi.fn().mockResolvedValue(null)
			}))
		});

		await expect(requireSupportThreadAccess(ctx, { threadId: 'thread_1' })).rejects.toThrow(
			'Support thread not found'
		);
		expect(getThreadMetadataMock).not.toHaveBeenCalled();
	});

	it('returns the registry record without agent lookup when only support membership is needed', async () => {
		const ctx = createCtx();
		safeGetAuthUserMock.mockResolvedValue({ _id: 'auth_user_1' } as never);
		(
			ctx as unknown as {
				db: { query: ReturnType<typeof vi.fn> };
			}
		).db.query.mockReturnValue({
			withIndex: vi.fn(() => ({
				first: vi.fn().mockResolvedValue({
					threadId: 'thread_1',
					userId: 'auth_user_1'
				})
			}))
		});

		const result = await requireSupportThreadRecord(ctx, { threadId: 'thread_1' });

		expect(result.supportThread).toEqual({ threadId: 'thread_1', userId: 'auth_user_1' });
		expect(getThreadMetadataMock).not.toHaveBeenCalled();
	});

	it('enforces message ownership through the parent thread', async () => {
		const ctx = createCtx();
		safeGetAuthUserMock.mockResolvedValue(undefined);
		(
			ctx as unknown as {
				db: { query: ReturnType<typeof vi.fn> };
			}
		).db.query.mockReturnValue({
			withIndex: vi.fn(() => ({
				first: vi.fn().mockResolvedValue({
					threadId: 'thread_1',
					userId: 'anon_owner'
				})
			}))
		});
		getThreadMetadataMock.mockResolvedValue({
			threadId: 'thread_1',
			userId: 'anon_owner'
		} as never);
		const runQuery = vi.fn().mockResolvedValue([{ threadId: 'thread_1' }]);
		(ctx as unknown as { runQuery: typeof runQuery }).runQuery = runQuery;

		const result = await assertMessageOwnership(ctx, {
			messageId: 'message_1',
			anonymousUserId: 'anon_owner'
		});

		expect(runQuery).toHaveBeenCalledOnce();
		expect(result.message).toEqual({ threadId: 'thread_1' });
		expect(result.owner.ownerId).toBe('anon_owner');
	});

	it('rejects missing messages before ownership checks continue', async () => {
		const ctx = createCtx();
		safeGetAuthUserMock.mockResolvedValue({ _id: 'auth_user_1' } as never);
		const runQuery = vi.fn().mockResolvedValue([null]);
		(ctx as unknown as { runQuery: typeof runQuery }).runQuery = runQuery;

		await expect(
			assertMessageOwnership(ctx, {
				messageId: 'missing_message'
			})
		).rejects.toThrow('Message not found');
	});

	it('rejects messages that belong to non-support threads', async () => {
		const ctx = createCtx();
		safeGetAuthUserMock.mockResolvedValue({ _id: 'auth_user_1' } as never);
		(
			ctx as unknown as {
				db: { query: ReturnType<typeof vi.fn> };
			}
		).db.query.mockReturnValue({
			withIndex: vi.fn(() => ({
				first: vi.fn().mockResolvedValue(null)
			}))
		});
		const runQuery = vi.fn().mockResolvedValue([{ threadId: 'ai_thread_1' }]);
		(ctx as unknown as { runQuery: typeof runQuery }).runQuery = runQuery;

		await expect(
			assertMessageOwnership(ctx, {
				messageId: 'message_1'
			})
		).rejects.toThrow('Support thread not found');
	});
});
