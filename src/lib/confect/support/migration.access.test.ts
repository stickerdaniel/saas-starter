// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, components, internal } from '../../convex/_generated/api';
import type { Doc } from '../../convex/_generated/dataModel';
import schema from '../../convex/schema';
import authSchema from '../../convex-components/betterAuth/schema';
import { preloadComponent } from '../convexComponents.fixtures';
import { convexModules, preloadModules } from '../convexTest.modules';
import { SUPPORT_ERROR_CODES, createSupportError } from './errors';

const betterAuthModules = await preloadModules(
	import.meta.glob('../../convex-components/betterAuth/**/*.ts')
);
const agentComponent = await preloadComponent.agent();
const rateLimiterComponent = await preloadComponent.rateLimiter();

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	agentComponent.register(t);
	rateLimiterComponent.register(t);
	return t;
};
type Harness = ReturnType<typeof harness>;

async function signIn(t: Harness, email = 'ada@example.com') {
	const now = Date.now();
	const user = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'user',
			data: {
				name: 'Ada',
				email,
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

const MAX_MOVED_FILE_OWNERS = 1_000;

const addOwners = (t: Harness, ownerId: string, fileIds: readonly string[]) =>
	t.run(async (ctx) => {
		for (const fileId of fileIds) await ctx.db.insert('fileOwners', { fileId, ownerId });
	});

const ownedBy = (t: Harness, ownerId: string) =>
	t.run(async (ctx) =>
		(
			await ctx.db
				.query('fileOwners')
				.withIndex('by_ownerId', (q) => q.eq('ownerId', ownerId))
				.take(2_000)
		)
			.map((row) => row.fileId)
			.sort()
	);

const fileIdsNumbered = (count: number) =>
	Array.from({ length: count }, (_, index) => `file_${String(index).padStart(4, '0')}`);

async function storeDraftFile(t: Harness) {
	const storageId = await t.run((ctx) =>
		ctx.storage.store(new Blob(['draft'], { type: 'text/plain' }))
	);
	const { fileId } = await t.mutation(components.agent.files.addFile, {
		storageId,
		hash: 'draft',
		filename: 'draft.txt',
		mediaType: 'text/plain'
	});
	return fileId;
}

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

describe('anonymous file owner migration', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('moves every owner row with the threads, so the account sends an old draft file', async () => {
		const t = harness();
		const { userId, caller } = await signIn(t);
		const ticket = await seedThread(t);
		const draft = await storeDraftFile(t);
		await addOwners(t, 'anon_owner', [draft]);
		const newer = fileIdsNumbered(100);
		await addOwners(t, 'anon_owner', newer);
		await addOwners(t, 'anon_other', ['file_other']);

		await expect(
			caller.mutation(migrateAnonymousTickets, { anonymousUserId: 'anon_owner' })
		).resolves.toEqual({ migratedCount: 1 });

		expect(await ownedBy(t, 'anon_owner')).toEqual([]);
		expect(await ownedBy(t, userId)).toEqual([...newer, draft].sort());
		expect(await ownedBy(t, 'anon_other')).toEqual(['file_other']);
		expect(await agentOwner(t, ticket)).toBe(userId);
		await expect(
			caller.mutation(api.support.messages.sendMessage, {
				threadId: ticket,
				prompt: 'My draft',
				fileIds: [draft]
			})
		).resolves.toEqual({ messageId: expect.any(String) });
	});

	it('keeps one row for a file the account already owns', async () => {
		const t = harness();
		const { userId, caller } = await signIn(t);
		await addOwners(t, 'anon_owner', ['file_shared', 'file_new']);
		await addOwners(t, userId, ['file_shared']);

		await caller.mutation(migrateAnonymousTickets, { anonymousUserId: 'anon_owner' });

		expect(await ownedBy(t, userId)).toEqual(['file_new', 'file_shared']);
		expect(await ownedBy(t, 'anon_owner')).toEqual([]);
	});

	it('leaves a second account nothing from before the first migration', async () => {
		const t = harness();
		const first = await signIn(t, 'first@example.com');
		const second = await signIn(t, 'second@example.com');
		await addOwners(t, 'anon_owner', ['file_before']);
		await seedThread(t);

		await first.caller.mutation(migrateAnonymousTickets, { anonymousUserId: 'anon_owner' });
		await t.mutation(internal.files.owners.record, {
			fileId: 'file_after',
			ownerId: 'anon_owner'
		});

		expect(await ownedBy(t, 'anon_owner')).toEqual(['file_after']);
		await expect(
			second.caller.mutation(migrateAnonymousTickets, { anonymousUserId: 'anon_owner' })
		).resolves.toEqual({ migratedCount: 0 });
		expect(await ownedBy(t, first.userId)).toEqual(['file_before']);
		expect(await ownedBy(t, second.userId)).toEqual(['file_after']);
	});

	it('moves exactly the threshold of owner rows', async () => {
		const t = harness();
		const { userId, caller } = await signIn(t);
		const fileIds = fileIdsNumbered(MAX_MOVED_FILE_OWNERS);
		await addOwners(t, 'anon_owner', fileIds);

		await caller.mutation(migrateAnonymousTickets, { anonymousUserId: 'anon_owner' });

		expect(await ownedBy(t, userId)).toEqual(fileIds);
	}, 30_000);

	it('refuses the whole migration above the threshold and moves nothing', async () => {
		const t = harness();
		const { userId, caller } = await signIn(t);
		const ticket = await seedThread(t);
		const fileIds = fileIdsNumbered(MAX_MOVED_FILE_OWNERS + 1);
		await addOwners(t, 'anon_owner', fileIds);
		const before = await threads(t);

		expect(
			await refusal(caller.mutation(migrateAnonymousTickets, { anonymousUserId: 'anon_owner' }))
		).toEqual({ code: SUPPORT_ERROR_CODES.migrationTooManyFiles });

		expect(await threads(t)).toEqual(before);
		expect(await agentOwner(t, ticket)).toBe('anon_owner');
		expect(await ownedBy(t, 'anon_owner')).toEqual(fileIds);
		expect(await ownedBy(t, userId)).toEqual([]);
	}, 30_000);
});
