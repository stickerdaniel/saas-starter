import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../authServer', () => ({
	authComponent: {
		safeGetAuthUser: vi.fn()
	}
}));

import { getSupportOwnerIdentity } from '../ownership';
import { authComponent } from '../../authServer';

const safeGetAuthUserMock = authComponent.safeGetAuthUser as unknown as ReturnType<typeof vi.fn>;

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
});
