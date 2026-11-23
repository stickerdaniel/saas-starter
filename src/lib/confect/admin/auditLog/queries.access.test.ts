// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';
import { api, components } from '../../../convex/_generated/api';
import schema from '../../../convex/schema';
import authSchema from '../../../convex-components/betterAuth/schema';
import { convexModules, preloadModules } from '../../convexTest.modules';
import { ADMIN_ERROR_CODES, createAdminError } from '../errors';

const betterAuthModules = await preloadModules(
	import.meta.glob('../../../convex-components/betterAuth/**/*.ts')
);

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	return t;
};
type Harness = ReturnType<typeof harness>;
type Caller = Pick<Harness, 'query'>;

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

const calls = (caller: Caller) => [
	caller.query(api.admin.auditLog.queries.getAuditLogCount, {}),
	caller.query(api.admin.auditLog.queries.listAuditLogs, { numItems: 10 }),
	caller.query(api.admin.auditLog.queries.resolveAuditLogLastPage, { numItems: 10 }),
	caller.query(api.admin.auditLog.queries.resolveAuditLogUser, { userId: 'someone' })
];

async function seedLogs(t: Harness, adminUserId: string) {
	const targetUserId = await createUser(t, 'user', 'target@example.com');
	await t.run(async (ctx) => {
		await ctx.db.insert('adminAuditLogs', {
			adminUserId,
			action: 'ban_user',
			targetUserId,
			metadata: { reason: 'spam' },
			timestamp: 1
		});
		await ctx.db.insert('adminAuditLogs', {
			adminUserId,
			action: 'revoke_sessions',
			targetUserId: 'deleted-user',
			timestamp: 2
		});
		await ctx.db.insert('adminAuditLogs', {
			adminUserId,
			action: 'ban_user',
			targetUserId,
			metadata: { reason: 'again' },
			timestamp: 3
		});
	});
	return targetUserId;
}

describe('audit log queries access', () => {
	it('refuses an anonymous caller on every query', async () => {
		const t = harness();

		const refusals = await Promise.all(calls(t).map(refusal));

		expect(refusals).toEqual(Array(4).fill('Unauthenticated'));
	});

	it('refuses a signed-in non-admin on every query', async () => {
		const t = harness();
		const user = await signIn(t, 'user', 'user@example.com');

		const refusals = await Promise.all(calls(user.caller).map(refusal));

		expect(refusals).toEqual(
			Array(4).fill(createAdminError(ADMIN_ERROR_CODES.accessRequired).data)
		);
	});
});

describe('audit log queries as an admin', () => {
	it('lists rows with resolved, deleted and metadata-free references', async () => {
		const t = harness();
		const admin = await signIn(t, 'admin', 'admin@example.com');
		const targetUserId = await seedLogs(t, admin.userId);

		const page = await admin.caller.query(api.admin.auditLog.queries.listAuditLogs, {
			numItems: 2,
			sortBy: { field: 'timestamp', direction: 'asc' }
		});

		expect(page.isDone).toBe(false);
		expect(page.continueCursor).toMatch(/^audit:v1:/);
		expect(page.items).toEqual([
			{
				id: expect.any(String),
				action: 'ban_user',
				timestamp: 1,
				metadata: { reason: 'spam' },
				admin: { id: admin.userId, name: 'Ada', email: 'admin@example.com', exists: true },
				target: { id: targetUserId, name: 'Ada', email: 'target@example.com', exists: true }
			},
			{
				id: expect.any(String),
				action: 'revoke_sessions',
				timestamp: 2,
				admin: { id: admin.userId, name: 'Ada', email: 'admin@example.com', exists: true },
				target: { id: 'deleted-user', exists: false }
			}
		]);
		expect(Object.keys(page.items[1] ?? {})).not.toContain('metadata');
	});

	it('counts, finds the last page and resolves single users', async () => {
		const t = harness();
		const admin = await signIn(t, 'admin', 'admin@example.com');
		const targetUserId = await seedLogs(t, admin.userId);

		await expect(
			admin.caller.query(api.admin.auditLog.queries.getAuditLogCount, { actionFilter: 'ban_user' })
		).resolves.toBe(2);
		await expect(
			admin.caller.query(api.admin.auditLog.queries.resolveAuditLogLastPage, { numItems: 1 })
		).resolves.toEqual({ page: 3, cursor: expect.stringMatching(/^audit:v1:/) });
		await expect(
			admin.caller.query(api.admin.auditLog.queries.resolveAuditLogUser, { userId: targetUserId })
		).resolves.toEqual({
			id: targetUserId,
			name: 'Ada',
			email: 'target@example.com',
			exists: true
		});
		await expect(
			admin.caller.query(api.admin.auditLog.queries.resolveAuditLogUser, { userId: 'deleted-user' })
		).resolves.toEqual({ id: 'deleted-user', exists: false });
	});

	it('rejects an unreadable legacy cursor', async () => {
		const t = harness();
		const admin = await signIn(t, 'admin', 'admin@example.com');
		await seedLogs(t, admin.userId);

		const error = await admin.caller
			.query(api.admin.auditLog.queries.listAuditLogs, { numItems: 2, cursor: 'not-a-cursor' })
			.then(
				() => undefined,
				(reason: unknown) => reason
			);

		expect(error).toBeInstanceOf(Error);
		expect(error).not.toBeInstanceOf(ConvexError);
		expect(String(error)).toMatchInlineSnapshot(
			`"Error: Unexpected token 'o', "not-a-cursor" is not valid JSON"`
		);
	});
});
