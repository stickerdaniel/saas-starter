// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';
import { api, components, internal } from '../../../convex/_generated/api';
import schema from '../../../convex/schema';
import authSchema from '../../../convex-components/betterAuth/schema';
import { convexModules, preloadModules } from '../../convexTest.modules';
import { FOUNDER_WELCOME_DEFAULTS } from '../../emails/helpers';
import { FOUNDER_WELCOME_ERROR_CODES } from './errors';

const betterAuthModules = await preloadModules(
	import.meta.glob('../../../convex-components/betterAuth/**/*.ts')
);

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	return t;
};
type Harness = ReturnType<typeof harness>;

async function signIn(t: Harness, role: 'user' | 'admin', name: string, email: string) {
	const now = Date.now();
	const user = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'user',
			data: { name, email, emailVerified: true, role, createdAt: now, updatedAt: now }
		}
	})) as { _id: string };
	const session = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'session',
			data: {
				userId: user._id,
				token: crypto.randomUUID(),
				expiresAt: now + 60_000,
				createdAt: now,
				updatedAt: now
			}
		}
	})) as { _id: string };
	return {
		userId: user._id,
		caller: t.withIdentity({ subject: user._id, sessionId: session._id })
	};
}
const signInAdmin = (t: Harness, name: string, email: string) => signIn(t, 'admin', name, email);
type Admin = Awaited<ReturnType<typeof signInAdmin>>;

async function refusal(call: Promise<unknown>) {
	const error = await call.then(
		() => undefined,
		(reason: unknown) => reason
	);
	if (!(error instanceof ConvexError)) throw new Error(`Expected a ConvexError, got ${error}`);
	return error.data;
}

const welcome = {
	name: 'Sam',
	title: 'Founder',
	subject: FOUNDER_WELCOME_DEFAULTS.subject,
	body: FOUNDER_WELCOME_DEFAULTS.body
};

const becomeContact = (admin: Admin) =>
	admin.caller.mutation(api.admin.founderWelcome.mutations.updateConfig, welcome);

const readSetting = (t: Harness, key: string) =>
	t.run(
		async (ctx) =>
			(
				await ctx.db
					.query('adminSettings')
					.withIndex('by_key', (q) => q.eq('key', key))
					.unique()
			)?.value ?? null
	);

describe('founder welcome refusals', () => {
	it.each([
		{ field: 'name', value: ' <>\n', code: FOUNDER_WELCOME_ERROR_CODES.nameRequired },
		{ field: 'title', value: ' ', code: FOUNDER_WELCOME_ERROR_CODES.titleRequired },
		{ field: 'subject', value: '', code: FOUNDER_WELCOME_ERROR_CODES.subjectRequired },
		{ field: 'body', value: '\n', code: FOUNDER_WELCOME_ERROR_CODES.bodyRequired },
		{ field: 'replyTo', value: 'sam@example', code: FOUNDER_WELCOME_ERROR_CODES.replyToInvalid }
	])(
		'refuses a welcome with an unusable $field and stores nothing',
		async ({ field, value, code }) => {
			const t = harness();
			const admin = await signInAdmin(t, 'Sam Founder', 'sam@example.com');

			expect(
				await refusal(
					admin.caller.mutation(api.admin.founderWelcome.mutations.updateConfig, {
						...welcome,
						[field]: value
					})
				)
			).toEqual({ code });
			expect(await readSetting(t, 'founderWelcome.contactUserId')).toBeNull();
		}
	);

	it('refuses every contact-only mutation from an admin who is not the contact', async () => {
		const t = harness();
		await becomeContact(await signInAdmin(t, 'Sam Founder', 'sam@example.com'));
		const other = await signInAdmin(t, 'Kim Support', 'kim@example.com');

		const refusals = await Promise.all(
			[
				other.caller.mutation(api.admin.founderWelcome.mutations.stepDown, {}),
				other.caller.mutation(api.admin.founderWelcome.mutations.setFounderEmailEnabled, {
					email: 'feedback',
					enabled: true
				}),
				other.caller.mutation(api.admin.founderWelcome.mutations.updateFounderEmailTemplate, {
					email: 'cancellation',
					subject: '',
					body: ''
				})
			].map(refusal)
		);

		expect(refusals).toEqual(
			Array(3).fill({ code: FOUNDER_WELCOME_ERROR_CODES.notCurrentContact })
		);
	});

	it('refuses to step down while nobody is the contact', async () => {
		const t = harness();
		const admin = await signInAdmin(t, 'Sam Founder', 'sam@example.com');

		expect(
			await refusal(admin.caller.mutation(api.admin.founderWelcome.mutations.stepDown, {}))
		).toEqual({ code: FOUNDER_WELCOME_ERROR_CODES.notCurrentContact });
	});

	it.each([
		{ subject: ' ', body: 'Hi', code: FOUNDER_WELCOME_ERROR_CODES.subjectRequired },
		{ subject: 'Hello', body: '', code: FOUNDER_WELCOME_ERROR_CODES.bodyRequired }
	])('refuses a template with $code', async ({ subject, body, code }) => {
		const t = harness();
		const admin = await signInAdmin(t, 'Sam Founder', 'sam@example.com');
		await becomeContact(admin);

		expect(
			await refusal(
				admin.caller.mutation(api.admin.founderWelcome.mutations.updateFounderEmailTemplate, {
					email: 'feedback',
					subject,
					body
				})
			)
		).toEqual({ code });
		expect(await readSetting(t, 'founderFeedback.subject')).toBeNull();
	});
});

describe('founder welcome config', () => {
	it('prefills the form from the viewer before anyone is the contact', async () => {
		const t = harness();
		const admin = await signInAdmin(t, 'Ada Lovelace', 'ada@example.com');

		expect(
			await admin.caller.query(api.admin.founderWelcome.queries.getFounderWelcomeConfig, {})
		).toEqual({
			config: { enabled: false },
			viewerProfile: { name: 'Ada', title: '', replyTo: 'ada@example.com' }
		});
		expect(
			await t.query(internal.admin.founderWelcome.queries.getFounderWelcomeConfigInternal, {})
		).toEqual({ enabled: false });
	});

	it('stores a cleaned welcome and makes the caller the contact', async () => {
		const t = harness();
		const admin = await signInAdmin(t, 'Ada Lovelace', 'ada@example.com');

		await admin.caller.mutation(api.admin.founderWelcome.mutations.updateConfig, {
			name: ' Ada <ada>\n',
			title: ' Founder ',
			subject: ' Hi ',
			body: ' Welcome ',
			replyTo: ' '
		});

		const config = {
			enabled: true,
			contactUser: { id: admin.userId, name: 'Ada Lovelace', email: 'ada@example.com' },
			name: 'Ada ada',
			title: 'Founder',
			subject: 'Hi',
			body: 'Welcome',
			replyTo: 'ada@example.com'
		};
		expect(
			await admin.caller.query(api.admin.founderWelcome.queries.getFounderWelcomeConfig, {})
		).toEqual({
			config,
			viewerProfile: { name: 'Ada ada', title: 'Founder', replyTo: 'ada@example.com' }
		});
		expect(
			await t.query(internal.admin.founderWelcome.queries.getFounderWelcomeConfigInternal, {})
		).toEqual(config);
	});
});

describe('founder welcome access', () => {
	const publicCalls = (caller: Pick<Harness, 'query' | 'mutation'>) => [
		caller.query(api.admin.founderWelcome.queries.getFounderWelcomeConfig, {}),
		caller.query(api.admin.founderWelcome.queries.getFounderEmailSettings, {}),
		caller.mutation(api.admin.founderWelcome.mutations.updateConfig, welcome),
		caller.mutation(api.admin.founderWelcome.mutations.stepDown, {}),
		caller.mutation(api.admin.founderWelcome.mutations.setFounderEmailEnabled, {
			email: 'feedback',
			enabled: true
		}),
		caller.mutation(api.admin.founderWelcome.mutations.updateFounderEmailTemplate, {
			email: 'feedback',
			subject: 'Hi',
			body: 'Hi'
		})
	];
	const settings = (t: Harness) => t.run((ctx) => ctx.db.query('adminSettings').take(10));

	it('refuses an anonymous caller on every public function and serves the internal query', async () => {
		const t = harness();

		expect(await Promise.all(publicCalls(t).map(refusal))).toEqual(
			Array(6).fill('Unauthenticated')
		);
		expect(await settings(t)).toEqual([]);
		await expect(
			t.query(internal.admin.founderWelcome.queries.getFounderWelcomeConfigInternal, {})
		).resolves.toEqual({ enabled: false });
	});

	it('refuses a signed-in non-admin on every public function and writes nothing', async () => {
		const t = harness();
		const user = await signIn(t, 'user', 'Normal User', 'normal@example.com');

		expect(await Promise.all(publicCalls(user.caller).map(refusal))).toEqual(
			Array(6).fill({ code: 'ADMIN_ACCESS_REQUIRED' })
		);
		expect(await settings(t)).toEqual([]);
	});
});
