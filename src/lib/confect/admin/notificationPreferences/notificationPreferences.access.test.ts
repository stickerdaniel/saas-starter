// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';
import { api, components, internal } from '../../../convex/_generated/api';
import schema from '../../../convex/schema';
import authSchema from '../../../convex-components/betterAuth/schema';
import { convexModules, preloadModules } from '../../convexTest.modules';
import { NOTIFICATION_EMAIL_ALREADY_EXISTS, NOTIFICATION_PREFERENCE_ERROR_CODES } from './errors';

const betterAuthModules = await preloadModules(
	import.meta.glob('../../../convex-components/betterAuth/**/*.ts')
);

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	return t;
};
type Harness = ReturnType<typeof harness>;
type Caller = Pick<Harness, 'query' | 'mutation'>;

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
	return t.withIdentity({ subject: userId, sessionId: session._id });
}

async function changeEmail(t: Harness, userId: string, email: string) {
	const readUser = () =>
		t.query(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: '_id', operator: 'eq', value: userId }]
		});
	const oldDoc = await readUser();
	await t.mutation(components.betterAuth.adapter.updateOne, {
		input: { model: 'user', where: [{ field: '_id', value: userId }], update: { email } }
	});
	await t.mutation(internal.auth.onUpdate, { model: 'user', oldDoc, newDoc: await readUser() });
}

async function refusal(call: Promise<unknown>) {
	const error = await call.then(
		() => undefined,
		(reason: unknown) => reason
	);
	if (!(error instanceof ConvexError)) throw new Error(`Expected a ConvexError, got ${error}`);
	return error.data;
}

const preference = (email: string, userId?: string) => ({
	email,
	userId,
	isAdminUser: false,
	notifyNewSupportTickets: true,
	notifyUserReplies: true,
	notifyNewSignups: false,
	notifyNewCustomers: true,
	notifyCancellations: true,
	createdAt: 1,
	updatedAt: 1
});

const seed = (t: Harness, ...rows: Array<ReturnType<typeof preference>>) =>
	t.run(async (ctx) => {
		for (const row of rows) await ctx.db.insert('adminNotificationPreferences', row);
	});

const stored = (t: Harness) =>
	t.run(async (ctx) =>
		(await ctx.db.query('adminNotificationPreferences').take(100)).map(
			({ _id, _creationTime, ...row }) => row
		)
	);

const publicCalls = (caller: Caller) => [
	...[api.admin.notificationPreferences.queries, api.admin.notificationPreferences.index].flatMap(
		(group) => [
			caller.query(group.getNotificationRecipientCount, {}),
			caller.query(group.listNotificationRecipients, { numItems: 10 }),
			caller.query(group.resolveNotificationRecipientsLastPage, { numItems: 10 })
		]
	),
	...[api.admin.notificationPreferences.mutations, api.admin.notificationPreferences.index].flatMap(
		(group) => [
			caller.mutation(group.addCustomEmail, { email: 'new@example.com' }),
			caller.mutation(group.removeCustomEmail, { email: 'custom@example.com' }),
			caller.mutation(group.updatePreference, {
				email: 'custom@example.com',
				field: 'notifyNewSignups',
				value: true
			}),
			caller.mutation(group.updatePreferences, {
				emails: ['custom@example.com'],
				field: 'notifyNewSignups',
				value: true
			})
		]
	)
];

describe('notification preference access', () => {
	it('refuses an anonymous caller on every public function and writes nothing', async () => {
		const t = harness();
		await seed(t, preference('custom@example.com'));

		expect(await Promise.all(publicCalls(t).map(refusal))).toEqual(
			Array(14).fill('Unauthenticated')
		);
		expect(await stored(t)).toEqual([preference('custom@example.com')]);
	});

	it('refuses a signed-in non-admin on every public function and writes nothing', async () => {
		const t = harness();
		await seed(t, preference('custom@example.com'));
		const user = await signIn(t, 'user', 'user@example.com');

		expect(await Promise.all(publicCalls(user).map(refusal))).toEqual(
			Array(14).fill({ code: 'ADMIN_ACCESS_REQUIRED' })
		);
		expect(await stored(t)).toEqual([preference('custom@example.com')]);
	});

	it('serves every internal function without identity', async () => {
		const t = harness();
		await seed(t, preference('custom@example.com'), preference('signups@example.com'));
		await createUser(t, 'admin', 'Admin@Example.com');

		for (const group of [
			internal.admin.notificationPreferences.queries,
			internal.admin.notificationPreferences.index
		]) {
			expect(await t.query(group.getRecipientsForNotificationType, { type: 'newTickets' })).toEqual(
				['custom@example.com', 'signups@example.com']
			);
			expect(await t.query(group.getJourneyRecipients, { type: 'newSignups' })).toEqual({
				emails: [],
				truncated: false
			});
		}
		expect(
			await t.mutation(internal.admin.notificationPreferences.mutations.syncAllAdminPreferences, {})
		).toEqual({ synced: 1, skipped: 0 });
		expect(
			await t.mutation(internal.admin.notificationPreferences.index.syncAllAdminPreferences, {})
		).toEqual({ synced: 0, skipped: 1 });
		expect((await stored(t)).map(({ email, isAdminUser }) => [email, isAdminUser])).toEqual([
			['custom@example.com', false],
			['signups@example.com', false],
			['admin@example.com', true]
		]);
	});
});

describe('notification preference refusals', () => {
	it.each([
		['mutations', api.admin.notificationPreferences.mutations],
		['index', api.admin.notificationPreferences.index]
	] as const)(
		'refuses unusable recipients through %s with their codes and writes nothing',
		async (_module, group) => {
			const t = harness();
			const userId = await createUser(t, 'admin', 'kim@example.com');
			await seed(t, preference('custom@example.com'), preference('kim@example.com', userId));
			const admin = await signIn(t, 'admin', 'admin@example.com');
			const before = await stored(t);

			expect(
				await Promise.all(
					[
						admin.mutation(group.addCustomEmail, { email: 'not-an-email' }),
						admin.mutation(group.addCustomEmail, { email: ' Custom@Example.com ' }),
						admin.mutation(group.removeCustomEmail, { email: 'missing@example.com' }),
						admin.mutation(group.removeCustomEmail, { email: 'kim@example.com' }),
						admin.mutation(group.updatePreference, {
							email: 'missing@example.com',
							field: 'notifyNewSignups',
							value: true
						}),
						admin.mutation(group.updatePreference, {
							email: 'kim@example.com',
							field: 'notifyNewSignups',
							value: true
						}),
						admin.mutation(group.updatePreferences, {
							emails: ['custom@example.com', 'custom@example.com'],
							field: 'notifyNewSignups',
							value: false
						}),
						admin.mutation(group.updatePreferences, {
							emails: ['custom@example.com', 'kim@example.com'],
							field: 'notifyNewSignups',
							value: false
						})
					].map(refusal)
				)
			).toEqual([
				{ code: NOTIFICATION_PREFERENCE_ERROR_CODES.invalidEmail },
				{ code: NOTIFICATION_EMAIL_ALREADY_EXISTS },
				{ code: NOTIFICATION_PREFERENCE_ERROR_CODES.emailNotFound },
				{ code: NOTIFICATION_PREFERENCE_ERROR_CODES.adminRecipientRequired },
				{ code: NOTIFICATION_PREFERENCE_ERROR_CODES.notFound },
				{ code: NOTIFICATION_PREFERENCE_ERROR_CODES.dormant },
				{ code: NOTIFICATION_PREFERENCE_ERROR_CODES.invalidBatch },
				{ code: NOTIFICATION_PREFERENCE_ERROR_CODES.dormant }
			]);
			expect(await stored(t)).toEqual(before);
		}
	);
});

describe('notification preferences as an admin', () => {
	it('adds a normalized custom email, toggles it, lists it and removes it', async () => {
		const t = harness();
		const admin = await signIn(t, 'admin', 'admin@example.com');
		const { mutations, queries } = api.admin.notificationPreferences;

		await admin.mutation(mutations.addCustomEmail, { email: ' New@Example.com ' });
		await admin.mutation(mutations.updatePreference, {
			email: 'new@example.com',
			field: 'notifyCancellations',
			value: false
		});

		const page = await admin.query(queries.listNotificationRecipients, {
			numItems: 10,
			typeFilter: 'custom'
		});
		expect(page).toMatchObject({ continueCursor: null, isDone: true });
		expect(page.items).toEqual([
			expect.objectContaining({
				email: 'new@example.com',
				isAdminUser: false,
				notifyNewSupportTickets: true,
				notifyUserReplies: true,
				notifyNewSignups: true,
				notifyNewCustomers: true,
				notifyCancellations: false
			})
		]);
		expect(page.items[0]).not.toHaveProperty('userId');
		expect(await admin.query(queries.getNotificationRecipientCount, { typeFilter: 'custom' })).toBe(
			1
		);

		await admin.mutation(mutations.removeCustomEmail, { email: 'NEW@example.com' });
		expect(await stored(t)).toEqual([]);
	});

	it("merges a custom recipient into an admin who takes over its email, keeping the recipient's toggles", async () => {
		const t = harness();
		const userId = await createUser(t, 'admin', 'kim@example.com');
		await seed(
			t,
			{ ...preference('kim@example.com', userId), isAdminUser: true },
			{
				...preference('kim@new.example.com'),
				notifyNewSupportTickets: false,
				notifyNewSignups: true,
				notifyCancellations: false
			}
		);

		await changeEmail(t, userId, 'kim@new.example.com');

		const merged = {
			email: 'kim@new.example.com',
			userId,
			isAdminUser: true,
			notifyNewSupportTickets: false,
			notifyUserReplies: true,
			notifyNewSignups: true,
			notifyNewCustomers: true,
			notifyCancellations: false,
			createdAt: 1,
			updatedAt: expect.any(Number)
		};
		expect(await stored(t)).toEqual([merged]);

		const admin = await signIn(t, 'admin', 'admin@example.com');
		await admin.mutation(api.admin.notificationPreferences.mutations.updatePreference, {
			email: 'kim@new.example.com',
			field: 'notifyNewSignups',
			value: false
		});
		expect(await stored(t)).toEqual([{ ...merged, notifyNewSignups: false }]);
	});

	it('merges the custom recipient when an older user row shares the new email', async () => {
		const t = harness();
		const userId = await createUser(t, 'admin', 'kim@example.com');
		const dormant = preference('kim@new.example.com', 'former-admin');
		await seed(
			t,
			dormant,
			{ ...preference('kim@example.com', userId), isAdminUser: true },
			{
				...preference('kim@new.example.com'),
				notifyNewSignups: true
			}
		);

		await changeEmail(t, userId, 'kim@new.example.com');

		expect(await stored(t)).toEqual([
			dormant,
			{
				...preference('kim@new.example.com', userId),
				isAdminUser: true,
				notifyNewSignups: true,
				updatedAt: expect.any(Number)
			}
		]);
	});
});
