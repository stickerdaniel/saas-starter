import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { FunctionReturnType } from 'convex/server';
import type { MutationCtx } from '../_generated/server';
import type { internal } from '../_generated/api';
import { ADMIN_ERROR_CODES } from './errors';
import { authComponent } from '../auth';

const { syncAdminPreferencesMock } = vi.hoisted(() => ({
	syncAdminPreferencesMock: vi.fn()
}));

vi.mock('./notificationPreferences/helpers', () => ({
	syncAdminPreferences: syncAdminPreferencesMock,
	deactivateAdminPreferencesHelper: vi.fn()
}));

import { seedFirstAdmin, setUserRole } from './mutations';

type MutationHandler<TArgs, TResult> = {
	_handler: (ctx: MutationCtx, args: TArgs) => Promise<TResult>;
};

type SeedFirstAdminResult = FunctionReturnType<typeof internal.admin.mutations.seedFirstAdmin>;
type ExpectedSeedFirstAdminResult =
	{ success: true } | { success: false; code: typeof ADMIN_ERROR_CODES.seedAdminExists };
type IsExact<TActual, TExpected> = [TActual] extends [TExpected]
	? [TExpected] extends [TActual]
		? true
		: false
	: false;

const seedFirstAdminHandler = seedFirstAdmin as unknown as MutationHandler<
	{ email: string },
	SeedFirstAdminResult
>;
const setUserRoleHandler = setUserRole as unknown as MutationHandler<
	{ userId: string; role: 'admin' | 'user' },
	{ success: boolean }
>;

function makeCtx(options: {
	admins?: unknown[];
	user?: { _id: string; email: string; role?: string } | null;
	adminCount?: number;
	queryError?: Error;
	updateError?: Error;
}) {
	const runQuery = vi.fn(async (_reference: unknown, args: { paginationOpts?: unknown }) => {
		if (options.queryError) throw options.queryError;
		if (args.paginationOpts) return { page: options.admins ?? [] };
		return options.user ?? null;
	});
	const runMutation = options.updateError
		? vi.fn().mockRejectedValue(options.updateError)
		: vi.fn().mockResolvedValue(null);
	const counters = {
		_id: 'counter',
		totalUsers: 2,
		adminCount: options.adminCount ?? 0,
		bannedCount: 0
	};
	const db = {
		query: () => ({ first: async () => counters }),
		patch: async (_table: string, _id: unknown, update: Partial<typeof counters>) => {
			Object.assign(counters, update);
		},
		insert: vi.fn()
	};
	return {
		ctx: { runQuery, runMutation, db } as unknown as MutationCtx,
		counters,
		runQuery,
		runMutation
	};
}

describe('seedFirstAdmin', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		syncAdminPreferencesMock.mockResolvedValue(undefined);
	});

	it('returns the exact structured result union', () => {
		expectTypeOf<
			IsExact<SeedFirstAdminResult, ExpectedSeedFirstAdminResult>
		>().toEqualTypeOf<true>();
		expectTypeOf<{ success: false; message: string }>().not.toExtend<SeedFirstAdminResult>();
	});

	it('checks one indexed admin before looking up the target user', async () => {
		const { ctx, runQuery, runMutation } = makeCtx({
			admins: [{ _id: 'existing-admin' }],
			user: null
		});

		await expect(
			seedFirstAdminHandler._handler(ctx, { email: 'missing@example.com' })
		).resolves.toEqual({
			success: false,
			code: ADMIN_ERROR_CODES.seedAdminExists
		});
		expect(runQuery).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
			model: 'user',
			where: [{ field: 'role', operator: 'eq', value: 'admin' }],
			paginationOpts: { cursor: null, numItems: 1 }
		});
		expect(runMutation).not.toHaveBeenCalled();
		expect(syncAdminPreferencesMock).not.toHaveBeenCalled();
	});

	it('throws the existing structured error only after confirming no admin exists', async () => {
		const { ctx, runQuery } = makeCtx({ admins: [], user: null });

		await expect(
			seedFirstAdminHandler._handler(ctx, { email: 'missing@example.com' })
		).rejects.toMatchObject({ data: { code: ADMIN_ERROR_CODES.userNotFound } });
		expect(runQuery).toHaveBeenCalledTimes(2);
	});

	it('promotes the target user and syncs notification preferences', async () => {
		const user = { _id: 'user_1', email: 'admin@example.com' };
		const { ctx, runQuery, runMutation, counters } = makeCtx({ admins: [], user });

		await expect(seedFirstAdminHandler._handler(ctx, { email: user.email })).resolves.toEqual({
			success: true
		});
		expect(runQuery).toHaveBeenCalledTimes(2);
		expect(runQuery.mock.calls[1]?.[1]).toEqual({
			model: 'user',
			where: [{ field: 'email', operator: 'eq', value: user.email }]
		});
		expect(runMutation).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
			input: {
				model: 'user',
				where: [{ field: '_id', operator: 'eq', value: user._id }],
				update: { role: 'admin' }
			}
		});
		expect(syncAdminPreferencesMock).toHaveBeenCalledExactlyOnceWith(ctx, {
			userId: user._id,
			email: user.email
		});
		expect(counters.adminCount).toBe(1);
	});

	it('propagates provider query failures unchanged', async () => {
		const defect = new Error('query failed');
		const { ctx } = makeCtx({ queryError: defect });

		await expect(seedFirstAdminHandler._handler(ctx, { email: 'admin@example.com' })).rejects.toBe(
			defect
		);
	});

	it('propagates provider update failures unchanged', async () => {
		const defect = new Error('update failed');
		const { ctx } = makeCtx({
			admins: [],
			user: { _id: 'user_1', email: 'admin@example.com' },
			updateError: defect
		});

		await expect(seedFirstAdminHandler._handler(ctx, { email: 'admin@example.com' })).rejects.toBe(
			defect
		);
		expect(syncAdminPreferencesMock).not.toHaveBeenCalled();
	});

	it('propagates notification preference failures unchanged', async () => {
		const defect = new Error('preferences failed');
		const { ctx } = makeCtx({
			admins: [],
			user: { _id: 'user_1', email: 'admin@example.com' }
		});
		syncAdminPreferencesMock.mockRejectedValueOnce(defect);

		await expect(seedFirstAdminHandler._handler(ctx, { email: 'admin@example.com' })).rejects.toBe(
			defect
		);
	});
});

describe('role change counters', () => {
	it.each([
		{ previous: 'user', next: 'admin' as const, initial: 1, expected: 2 },
		{ previous: 'admin', next: 'user' as const, initial: 2, expected: 1 },
		{ previous: 'admin', next: 'admin' as const, initial: 2, expected: 2 },
		{ previous: undefined, next: 'user' as const, initial: 1, expected: 1 }
	])(
		'$previous to $next leaves $expected admins',
		async ({ previous, next, initial, expected }) => {
			const actor = { _id: 'actor', role: 'admin' };
			const auth = vi.spyOn(authComponent, 'getAuthUser').mockResolvedValue(actor as never);
			const { ctx, counters } = makeCtx({
				user: { _id: 'target', email: 'target@example.com', role: previous },
				admins: [actor, { _id: 'target', role: 'admin' }],
				adminCount: initial
			});
			try {
				await expect(
					setUserRoleHandler._handler(ctx, { userId: 'target', role: next })
				).resolves.toEqual({ success: true });
				expect(counters.adminCount).toBe(expected);
			} finally {
				auth.mockRestore();
			}
		}
	);
});
