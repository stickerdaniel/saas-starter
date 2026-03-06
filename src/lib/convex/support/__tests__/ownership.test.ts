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
	assertThreadOwnership,
	getSupportOwnerIdentity,
	requireSupportOwnerIdentity
} from '../ownership';
import { authComponent } from '../../auth';
import { supportAgent } from '../agent';

const safeGetAuthUserMock = vi.mocked(authComponent.safeGetAuthUser);
const getThreadMetadataMock = vi.mocked(supportAgent.getThreadMetadata);

function createCtx() {
	return {
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
		getThreadMetadataMock.mockResolvedValue({
			threadId: 'thread_1',
			userId: 'auth_user_1'
		} as never);

		const result = await assertThreadOwnership(ctx, { threadId: 'thread_1' });

		expect(result.owner).toEqual({
			ownerId: 'auth_user_1',
			isAnonymous: false
		});
		expect(result.thread).toEqual({ threadId: 'thread_1', userId: 'auth_user_1' });
	});

	it('allows an anonymous owner with the matching proof token', async () => {
		const ctx = createCtx();
		safeGetAuthUserMock.mockResolvedValue(undefined);
		getThreadMetadataMock.mockResolvedValue({
			threadId: 'thread_1',
			userId: 'anon_owner'
		} as never);

		const result = await assertThreadOwnership(ctx, {
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
		getThreadMetadataMock.mockResolvedValue({
			threadId: 'thread_1',
			userId: 'auth_user_1'
		} as never);

		await expect(assertThreadOwnership(ctx, { threadId: 'thread_1' })).rejects.toThrow(
			"Unauthorized: Cannot access another user's thread"
		);
	});

	it('enforces message ownership through the parent thread', async () => {
		const ctx = createCtx();
		safeGetAuthUserMock.mockResolvedValue(undefined);
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
});
