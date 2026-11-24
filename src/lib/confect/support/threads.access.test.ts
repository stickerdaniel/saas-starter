// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import agentSchema from '../../../../node_modules/@convex-dev/agent/dist/component/schema.js';
import rateLimiterSchema from '../../../../node_modules/@convex-dev/rate-limiter/dist/component/schema.js';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, components } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import authSchema from '../../convex-components/betterAuth/schema';
import { convexModules, preloadModules } from '../convexTest.modules';
import { SUPPORT_ERROR_CODES } from './errors';

const betterAuthModules = await preloadModules(
	import.meta.glob('../../convex-components/betterAuth/**/*.ts')
);
const agentModules = await preloadModules(
	import.meta.glob('../../../../node_modules/@convex-dev/agent/dist/component/**/*.js')
);
const rateLimiterModules = await preloadModules(
	import.meta.glob('../../../../node_modules/@convex-dev/rate-limiter/dist/component/**/*.js')
);

const OWNER = 'anon_owner';
const STRANGER = 'anon_stranger';

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	t.registerComponent('agent', agentSchema, agentModules);
	t.registerComponent('rateLimiter', rateLimiterSchema, rateLimiterModules);
	return t;
};
type Harness = ReturnType<typeof harness>;

async function refusal(call: Promise<unknown>) {
	const error = await call.then(
		() => undefined,
		(reason: unknown) => reason
	);
	if (!(error instanceof ConvexError)) throw new Error(`Expected a ConvexError, got ${error}`);
	return error.data;
}

const supportThreads = (t: Harness) => t.run((ctx) => ctx.db.query('supportThreads').take(100));

const messageContexts = async (t: Harness) =>
	(await t.run((ctx) => ctx.db.query('supportMessageContexts').take(100))).map(
		({ _id, _creationTime, ...context }) => context
	);

const agentMessages = async (t: Harness, threadId: string) =>
	(
		await t.query(components.agent.messages.listMessagesByThreadId, {
			threadId,
			order: 'asc',
			paginationOpts: { numItems: 10, cursor: null }
		})
	).page;

async function ownedThread(t: Harness) {
	const { threadId } = await t.mutation(api.support.threads.getOrCreateWarmThread, {
		anonymousUserId: OWNER
	});
	return threadId;
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('support thread access', () => {
	it.each([{}, { anonymousUserId: 'visitor_1' }])(
		'refuses to create a thread without an owner: %j',
		async (owner) => {
			const t = harness();

			for (const create of [
				t.mutation(api.support.threads.createThread, owner),
				t.mutation(api.support.threads.getOrCreateWarmThread, owner)
			]) {
				expect(await refusal(create)).toEqual({
					code: SUPPORT_ERROR_CODES.authenticationRequired
				});
			}
			expect(await supportThreads(t)).toEqual([]);
		}
	);

	it('refuses an owned thread in the order unknown, unauthenticated, foreign', async () => {
		const t = harness();
		const threadId = await ownedThread(t);
		const before = await supportThreads(t);
		const calls = (args: { threadId: string; anonymousUserId?: string }) => [
			t.query(api.support.threads.getThread, args),
			t.mutation(api.support.threads.updateThreadHandoff, args),
			t.mutation(api.support.threads.updateNotificationEmail, { ...args, email: 'a@b.co' })
		];

		for (const [args, code] of [
			[{ threadId: 'thread_missing' }, SUPPORT_ERROR_CODES.threadNotFound],
			[{ threadId }, SUPPORT_ERROR_CODES.authenticationRequired],
			[{ threadId, anonymousUserId: STRANGER }, SUPPORT_ERROR_CODES.threadForbidden]
		] as const) {
			for (const call of calls(args)) expect(await refusal(call)).toEqual({ code });
		}
		expect(await supportThreads(t)).toEqual(before);
		expect(await agentMessages(t, threadId)).toEqual([]);
	});

	it('lists nothing without an owner and only the own started threads with one', async () => {
		const t = harness();
		await ownedThread(t);
		const { threadId } = await t.mutation(api.support.threads.createThread, {
			anonymousUserId: OWNER
		});
		await t.mutation(api.support.threads.createThread, { anonymousUserId: STRANGER });

		await expect(t.query(api.support.threads.listThreads, {})).resolves.toEqual({
			page: [],
			isDone: true,
			continueCursor: ''
		});
		const listed = await t.query(api.support.threads.listThreads, { anonymousUserId: OWNER });
		expect(listed.page.map(({ _id, userId }) => ({ _id, userId }))).toEqual([
			{ _id: threadId, userId: OWNER }
		]);
	});

	it('shows admin names and avatars to a visitor without an owner', async () => {
		const t = harness();
		const now = Date.now();
		for (const [name, role] of [
			['Ada', 'admin'],
			['Max', 'user']
		]) {
			await t.mutation(components.betterAuth.adapter.create, {
				input: {
					model: 'user',
					data: {
						name,
						email: `${name.toLowerCase()}@example.com`,
						emailVerified: true,
						role,
						createdAt: now,
						updatedAt: now
					}
				}
			});
		}

		await expect(t.query(api.support.threads.getAdminAvatars, {})).resolves.toEqual([
			{ name: 'Ada', image: null }
		]);
	});
});

describe('support notification email', () => {
	it('refuses an invalid address and keeps the stored one', async () => {
		const t = harness();
		const threadId = await ownedThread(t);
		const args = { threadId, anonymousUserId: OWNER };
		await t.mutation(api.support.threads.updateNotificationEmail, {
			...args,
			email: ' Ada@Example.COM '
		});

		expect(
			await refusal(
				t.mutation(api.support.threads.updateNotificationEmail, { ...args, email: 'not-an-email' })
			)
		).toEqual({ code: SUPPORT_ERROR_CODES.notificationEmailInvalid });
		await expect(t.query(api.support.threads.getThread, args)).resolves.toMatchObject({
			notificationEmail: 'ada@example.com'
		});

		await t.mutation(api.support.threads.updateNotificationEmail, { ...args, email: '  ' });
		expect((await supportThreads(t))[0]?.notificationEmail).toBeUndefined();
	});
});

describe('support handoff route metadata', () => {
	it('records the current route against the saved request message id', async () => {
		const t = harness();
		const threadId = await ownedThread(t);

		await t.mutation(api.support.threads.updateThreadHandoff, {
			threadId,
			anonymousUserId: OWNER,
			pageUrl: 'https://example.com/fr/app/settings?tab=billing#plan'
		});

		const request = (await agentMessages(t, threadId)).find(
			(message) => message.message?.role === 'user'
		);
		expect(await messageContexts(t)).toEqual([
			{
				threadId,
				messageId: request?._id,
				pageUrl: '/fr/app/settings',
				createdAt: expect.any(Number)
			}
		]);
	});

	it('records the build of the requesting tab, also when its route is rejected', async () => {
		const t = harness();
		const threadId = await ownedThread(t);
		const build = '1399ac4b8bcef49fc000539465743aa1a24720ce';

		await t.mutation(api.support.threads.updateThreadHandoff, {
			threadId,
			anonymousUserId: OWNER,
			pageUrl: 'javascript:alert(1)',
			appVersion: build
		});

		const request = (await agentMessages(t, threadId)).find(
			(message) => message.message?.role === 'user'
		);
		expect(await messageContexts(t)).toEqual([
			{ threadId, messageId: request?._id, appVersion: build, createdAt: expect.any(Number) }
		]);
	});

	it('keeps the handoff when the route is invalid or absent', async () => {
		const t = harness();
		const threadId = await ownedThread(t);

		await expect(
			t.mutation(api.support.threads.updateThreadHandoff, {
				threadId,
				anonymousUserId: OWNER,
				pageUrl: 'javascript:alert(1)'
			})
		).resolves.toBe(true);

		expect(await agentMessages(t, threadId)).toHaveLength(2);
		expect(await messageContexts(t)).toEqual([]);
		expect(await supportThreads(t)).toEqual([expect.objectContaining({ isHandedOff: true })]);
	});
});
