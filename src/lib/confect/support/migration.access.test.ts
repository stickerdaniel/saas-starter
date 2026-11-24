// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import agentSchema from '../../../../node_modules/@convex-dev/agent/dist/component/schema.js';
import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';
import { api, components } from '../../convex/_generated/api';
import type { Doc } from '../../convex/_generated/dataModel';
import schema from '../../convex/schema';
import authSchema from '../../convex-components/betterAuth/schema';
import { convexModules, preloadModules } from '../convexTest.modules';
import { SUPPORT_ERROR_CODES, createSupportError } from './errors';

const betterAuthModules = await preloadModules(
	import.meta.glob('../../convex-components/betterAuth/**/*.ts')
);
const agentModules = await preloadModules(
	import.meta.glob('../../../../node_modules/@convex-dev/agent/dist/component/**/*.js')
);

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	t.registerComponent('agent', agentSchema, agentModules);
	return t;
};
type Harness = ReturnType<typeof harness>;

async function signIn(t: Harness) {
	const now = Date.now();
	const user = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'user',
			data: {
				name: 'Ada',
				email: 'ada@example.com',
				emailVerified: true,
				role: 'user',
				createdAt: now,
				updatedAt: now
			}
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

async function refusal(call: Promise<unknown>) {
	const error = await call.then(
		() => undefined,
		(reason: unknown) => reason
	);
	if (!(error instanceof ConvexError)) throw new Error(`Expected a ConvexError, got ${error}`);
	return error.data;
}

const seedThread = (t: Harness, fields: Partial<Doc<'supportThreads'>> = {}) =>
	t.run(async (ctx) => {
		const userId = fields.userId ?? 'anon_owner';
		const { _id: threadId } = await ctx.runMutation(components.agent.threads.createThread, {
			userId
		});
		await ctx.db.insert('supportThreads', {
			threadId,
			userId,
			status: 'open',
			createdAt: 1,
			updatedAt: 2,
			...fields
		});
		return threadId;
	});

const threads = (t: Harness) => t.run((ctx) => ctx.db.query('supportThreads').take(100));

const agentOwner = (t: Harness, threadId: string) =>
	t.run(async (ctx) => {
		const thread = await ctx.runQuery(components.agent.threads.getThread, { threadId });
		return thread?.userId;
	});

const { migrateAnonymousTickets } = api.support.migration;

describe('anonymous ticket migration access', () => {
	it('refuses a caller without session before checking the anonymous id', async () => {
		const t = harness();
		await seedThread(t);
		const before = await threads(t);

		for (const anonymousUserId of ['anon_owner', 'visitor_1']) {
			expect(await refusal(t.mutation(migrateAnonymousTickets, { anonymousUserId }))).toBe(
				'Unauthenticated'
			);
		}
		expect(await threads(t)).toEqual(before);
	});

	it('refuses an id without the anonymous prefix', async () => {
		const t = harness();
		const { caller } = await signIn(t);
		await seedThread(t, { userId: 'visitor_1' });
		const before = await threads(t);

		expect(
			await refusal(caller.mutation(migrateAnonymousTickets, { anonymousUserId: 'visitor_1' }))
		).toEqual(createSupportError(SUPPORT_ERROR_CODES.anonymousUserInvalid).data);
		expect(await threads(t)).toEqual(before);
	});

	it('migrates nothing for an anonymous id without threads', async () => {
		const t = harness();
		const { caller } = await signIn(t);

		await expect(
			caller.mutation(migrateAnonymousTickets, { anonymousUserId: 'anon_owner' })
		).resolves.toEqual({ migratedCount: 0 });
	});

	it('moves the anonymous threads to the account and drops the warm one', async () => {
		const t = harness();
		const { userId, caller } = await signIn(t);
		const ticket = await seedThread(t, {
			title: 'Billing',
			summary: 'Upgrade issue',
			lastMessage: 'Anon message'
		});
		const kept = await seedThread(t, { notificationEmail: 'custom@example.com' });
		await seedThread(t, { isWarm: true });
		const foreign = await seedThread(t, { userId: 'anon_other' });
		const start = Date.now();

		await expect(
			caller.mutation(migrateAnonymousTickets, { anonymousUserId: 'anon_owner' })
		).resolves.toEqual({ migratedCount: 2 });

		const rows = await threads(t);
		expect(rows).toHaveLength(3);
		expect(rows.find((row) => row.threadId === ticket)).toMatchObject({
			userId,
			userName: 'Ada',
			userEmail: 'ada@example.com',
			searchText: 'billing | upgrade issue | anon message | ada | ada@example.com',
			notificationEmail: 'ada@example.com'
		});
		expect(rows.find((row) => row.threadId === ticket)?.updatedAt).toBeGreaterThanOrEqual(start);
		expect(rows.find((row) => row.threadId === kept)).toMatchObject({
			userId,
			notificationEmail: 'custom@example.com'
		});
		expect(rows.find((row) => row.threadId === foreign)).toMatchObject({
			userId: 'anon_other',
			updatedAt: 2
		});
		expect(await agentOwner(t, ticket)).toBe(userId);
		expect(await agentOwner(t, kept)).toBe(userId);
		expect(await agentOwner(t, foreign)).toBe('anon_other');
	});
});
