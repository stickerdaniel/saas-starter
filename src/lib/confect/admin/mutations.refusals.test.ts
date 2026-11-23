// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';
import { api, components, internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import authSchema from '../../convex-components/betterAuth/schema';
import { convexModules, preloadModules } from '../convexTest.modules';
import { ADMIN_ERROR_CODES, createAdminError, type AdminErrorCode } from './errors';

const betterAuthModules = await preloadModules(
	import.meta.glob('../../convex-components/betterAuth/**/*.ts')
);

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	return t;
};
type Harness = ReturnType<typeof harness>;

async function createUser(t: Harness, role: 'user' | 'admin', email: string) {
	const now = Date.now();
	const user = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'user',
			data: { name: 'Ada', email, emailVerified: true, role, createdAt: now, updatedAt: now }
		}
	})) as { _id: string };
	return user._id;
}

async function signIn(t: Harness, role: 'user' | 'admin', email: string) {
	const userId = await createUser(t, role, email);
	const now = Date.now();
	const session = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'session',
			data: {
				userId,
				token: crypto.randomUUID(),
				expiresAt: now + 60_000,
				createdAt: now,
				updatedAt: now
			}
		}
	})) as { _id: string };
	return { userId, caller: t.withIdentity({ subject: userId, sessionId: session._id }) };
}

async function refusal(call: Promise<unknown>) {
	const error = await call.then(
		() => undefined,
		(reason: unknown) => reason
	);
	if (!(error instanceof ConvexError)) throw new Error(`Expected a ConvexError, got ${error}`);
	return error.data;
}

const expected = (code: AdminErrorCode) => createAdminError(code).data;

const auditLogs = (t: Harness) => t.run((ctx) => ctx.db.query('adminAuditLogs').take(10));

const roleOf = (t: Harness, userId: string) =>
	t.query(components.betterAuth.adapter.findOne, {
		model: 'user',
		where: [{ field: '_id', operator: 'eq', value: userId }]
	}) as Promise<{ role?: string } | null>;

describe('setUserRole refusals', () => {
	it('refuses an admin changing their own role and writes nothing', async () => {
		const t = harness();
		const admin = await signIn(t, 'admin', 'admin@example.com');

		expect(
			await refusal(
				admin.caller.mutation(api.admin.mutations.setUserRole, {
					userId: admin.userId,
					role: 'user'
				})
			)
		).toEqual(expected(ADMIN_ERROR_CODES.cannotChangeOwnRole));
		expect(await auditLogs(t)).toEqual([]);
		expect((await roleOf(t, admin.userId))?.role).toBe('admin');
	});

	it('refuses an unknown target user', async () => {
		const t = harness();
		const admin = await signIn(t, 'admin', 'admin@example.com');

		expect(
			await refusal(
				admin.caller.mutation(api.admin.mutations.setUserRole, {
					userId: 'missing-user',
					role: 'admin'
				})
			)
		).toEqual(expected(ADMIN_ERROR_CODES.userNotFound));
		expect(await auditLogs(t)).toEqual([]);
	});

	it('promotes another user and records the change', async () => {
		const t = harness();
		const admin = await signIn(t, 'admin', 'admin@example.com');
		const target = await createUser(t, 'user', 'target@example.com');

		await expect(
			admin.caller.mutation(api.admin.mutations.setUserRole, { userId: target, role: 'admin' })
		).resolves.toEqual({ success: true });
		expect((await roleOf(t, target))?.role).toBe('admin');
		expect(await auditLogs(t)).toMatchObject([
			{
				adminUserId: admin.userId,
				action: 'set_role',
				targetUserId: target,
				metadata: { newRole: 'admin', previousRole: 'user' }
			}
		]);
	});
});

describe('banUser', () => {
	it('refuses an admin banning themselves with the code the admin page translates', async () => {
		const t = harness();
		const admin = await signIn(t, 'admin', 'admin@example.com');

		expect(
			await refusal(
				admin.caller.mutation(api.admin.mutations.banUser, {
					userId: admin.userId,
					reason: 'self'
				})
			)
		).toEqual({ code: 'ADMIN_CANNOT_BAN_SELF' });
		expect(await auditLogs(t)).toEqual([]);
	});
});

describe('seedFirstAdmin', () => {
	it('refuses an unknown email while no admin exists', async () => {
		const t = harness();

		expect(
			await refusal(
				t.mutation(internal.admin.mutations.seedFirstAdmin, { email: 'missing@example.com' })
			)
		).toEqual(expected(ADMIN_ERROR_CODES.userNotFound));
	});

	it('returns the existing-admin result without changing the target', async () => {
		const t = harness();
		await createUser(t, 'admin', 'admin@example.com');
		const target = await createUser(t, 'user', 'target@example.com');

		await expect(
			t.mutation(internal.admin.mutations.seedFirstAdmin, { email: 'target@example.com' })
		).resolves.toEqual({ success: false, code: ADMIN_ERROR_CODES.seedAdminExists });
		expect((await roleOf(t, target))?.role).toBe('user');
	});
});
