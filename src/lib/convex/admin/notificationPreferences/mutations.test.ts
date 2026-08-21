import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../auth', () => ({
	authComponent: {
		getAuthUser: vi.fn(),
		safeGetAuthUser: vi.fn()
	}
}));

vi.mock('../../_generated/api', () => ({
	components: { betterAuth: { adapter: {} } }
}));

import { authComponent } from '../../auth';
import { addCustomEmail } from './mutations';
import { NOTIFICATION_EMAIL_ALREADY_EXISTS } from './errors';

const getAuthUserMock = authComponent.getAuthUser as unknown as ReturnType<typeof vi.fn>;

type RegisteredFunction<TArgs, TResult> = {
	_handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const addCustomEmailHandler = addCustomEmail as unknown as RegisteredFunction<
	{ email: string },
	null
>;

function makeCtx(existing: unknown) {
	const first = vi.fn().mockResolvedValue(existing);
	const insert = vi.fn().mockResolvedValue('preference_1');
	return {
		ctx: {
			db: {
				query: vi.fn(() => ({
					withIndex: vi.fn((_name, apply) => {
						apply({ eq: vi.fn(() => undefined) });
						return { first };
					})
				})),
				insert
			}
		},
		first,
		insert
	};
}

describe('addCustomEmail', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getAuthUserMock.mockResolvedValue({ _id: 'admin_1', role: 'admin' });
	});

	it('throws structured refusal data before any write for a duplicate', async () => {
		const { ctx, insert } = makeCtx({ _id: 'preference_1' });

		await expect(
			addCustomEmailHandler._handler(ctx, { email: ' EXISTING@example.com ' })
		).rejects.toMatchObject({ data: { code: NOTIFICATION_EMAIL_ALREADY_EXISTS } });
		expect(insert).not.toHaveBeenCalled();
	});

	it('normalizes and inserts a new address', async () => {
		const { ctx, insert } = makeCtx(null);

		await expect(
			addCustomEmailHandler._handler(ctx, { email: ' NEW@example.com ' })
		).resolves.toBeNull();
		expect(insert).toHaveBeenCalledWith(
			'adminNotificationPreferences',
			expect.objectContaining({ email: 'new@example.com', isAdminUser: false })
		);
	});
});
