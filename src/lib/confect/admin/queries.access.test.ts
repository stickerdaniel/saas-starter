// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';
import { api, components } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import authSchema from '../../convex-components/betterAuth/schema';
import { convexModules, preloadModules } from '../convexTest.modules';
import { ADMIN_ERROR_CODES, createAdminError } from './errors';

const betterAuthModules = await preloadModules(
	import.meta.glob('../../convex-components/betterAuth/**/*.ts')
);

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	return t;
};
type Harness = ReturnType<typeof harness>;
type Caller = Pick<Harness, 'query'>;

async function createUser(t: Harness, role: 'user' | 'admin', email: string, createdAt: number) {
	const user = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'user',
			data: { name: 'Ada', email, emailVerified: true, role, createdAt, updatedAt: createdAt }
		}
	})) as { _id: string };
	return user._id;
}

async function signIn(t: Harness, role: 'user' | 'admin', email: string) {
	const now = Date.now();
	const userId = await createUser(t, role, email, now);
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
	caller.query(api.admin.queries.getDashboardMetrics, {}),
	caller.query(api.admin.queries.getUserCount, {}),
	caller.query(api.admin.queries.listUsers, { numItems: 10 }),
	caller.query(api.admin.queries.resolveUsersLastPage, { numItems: 10 })
];

describe('admin user queries access', () => {
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

describe('admin user queries as an admin', () => {
	it('lists users whose optional fields are absent', async () => {
		const t = harness();
		const admin = await signIn(t, 'admin', 'admin@example.com');
		const plainId = await createUser(t, 'user', 'plain@example.com', 1);

		const page = await admin.caller.query(api.admin.queries.listUsers, { numItems: 10 });

		expect(page.isDone).toBe(true);
		expect(page.items.map((item) => item.email).sort()).toEqual([
			'admin@example.com',
			'plain@example.com'
		]);
		expect(page.items.find((item) => item.id === plainId)).toEqual({
			id: plainId,
			name: 'Ada',
			email: 'plain@example.com',
			emailVerified: true,
			role: 'user',
			banned: false,
			providers: [],
			createdAt: 1,
			updatedAt: 1
		});
	});

	it('counts and pages the users and reads the dashboard counters', async () => {
		const t = harness();
		const admin = await signIn(t, 'admin', 'admin@example.com');
		await createUser(t, 'user', 'plain@example.com', 1);

		await expect(
			admin.caller.query(api.admin.queries.getUserCount, { roleFilter: 'admin' })
		).resolves.toBe(1);
		await expect(
			admin.caller.query(api.admin.queries.resolveUsersLastPage, { numItems: 1 })
		).resolves.toEqual({ page: 1, cursor: null });
		await expect(admin.caller.query(api.admin.queries.getDashboardMetrics, {})).resolves.toEqual({
			totalUsers: 0,
			adminCount: 0,
			bannedCount: 0,
			activeIn24h: 1,
			recentSignups: 0
		});
	});
});
