// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import agentSchema from '../../../../../node_modules/@convex-dev/agent/dist/component/schema.js';
import rateLimiterSchema from '../../../../../node_modules/@convex-dev/rate-limiter/dist/component/schema.js';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, components } from '../../../convex/_generated/api';
import schema from '../../../convex/schema';
import authSchema from '../../../convex-components/betterAuth/schema';
import type { Id } from '../../../convex/_generated/dataModel';
import { MAX_MESSAGE_FILES, MAX_MESSAGE_LENGTH } from '../../constants';
import { convexModules, preloadModules } from '../../convexTest.modules';
import { AI_CHAT_ERROR_CODES } from '../errors';

const betterAuthModules = await preloadModules(
	import.meta.glob('../../../convex-components/betterAuth/**/*.ts')
);
const agentModules = await preloadModules(
	import.meta.glob('../../../../../node_modules/@convex-dev/agent/dist/component/**/*.js')
);
const rateLimiterModules = await preloadModules(
	import.meta.glob('../../../../../node_modules/@convex-dev/rate-limiter/dist/component/**/*.js')
);

const MESSAGE_BURST = 5;
const DAY = 24 * 60 * 60 * 1000;
const REPLY = 'aiChat/messages:createAIResponse';
const TITLE = 'aiChat/titles:generateThreadTitle';

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	t.registerComponent('agent', agentSchema, agentModules);
	t.registerComponent('rateLimiter', rateLimiterSchema, rateLimiterModules);
	return t;
};
type Harness = ReturnType<typeof harness>;

async function signIn(t: Harness, email: string) {
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
				expiresAt: now + DAY,
				createdAt: now,
				updatedAt: now
			}
		}
	})) as { _id: string };
	const caller = t.withIdentity({ subject: user._id, sessionId: session._id });
	const { _id: threadId } = await t.mutation(components.agent.threads.createThread, {
		userId: user._id
	});
	await t.run((ctx) =>
		ctx.db.insert('aiChatThreads', { threadId, userId: user._id, createdAt: now, isWarm: true })
	);
	return { userId: user._id, threadId, caller };
}

async function refusal(call: Promise<unknown>) {
	const error = await call.then(
		() => undefined,
		(reason: unknown) => reason
	);
	if (!(error instanceof ConvexError)) throw new Error(`Expected a ConvexError, got ${error}`);
	return error.data;
}

const effects = (t: Harness) =>
	t.run(async (ctx) => ({
		receipts: (await ctx.db.query('aiChatMessageReceipts').take(20)).map((row) => row.userId),
		jobs: (await ctx.db.system.query('_scheduled_functions').take(20)).map((job) => ({
			name: job.name.replace('.js', ''),
			args: job.args[0]
		})),
		warm: (await ctx.db.query('aiChatThreads').take(20))
			.filter((row) => row.isWarm)
			.map((row) => row.threadId)
	}));

async function storeFile(t: Harness, ownerId?: string, hash = 'notes') {
	const storageId = await t.run((ctx) =>
		ctx.storage.store(new Blob([hash], { type: 'text/plain' }))
	);
	const { fileId } = await t.mutation(components.agent.files.addFile, {
		storageId,
		hash,
		filename: `${hash}.txt`,
		mediaType: 'text/plain'
	});
	if (ownerId !== undefined) {
		await t.run((ctx) => ctx.db.insert('fileOwners', { fileId, ownerId }));
	}
	return fileId;
}

async function removeStorageBlob(t: Harness, fileId: string) {
	const file = await t.query(components.agent.files.get, { fileId });
	if (!file) throw new Error(`No component file ${fileId}`);
	await t.run((ctx) => ctx.storage.delete(file.storageId as Id<'_storage'>));
}

const fileParts = async (t: Harness, threadId: string) => {
	const { page } = await t.query(components.agent.messages.listMessagesByThreadId, {
		threadId,
		order: 'asc',
		paginationOpts: { numItems: 10, cursor: null }
	});
	return page
		.flatMap(({ message }) =>
			Array.isArray(message?.content) ? message.content.map((part) => part.type) : []
		)
		.filter((type) => type === 'file').length;
};

beforeEach(() => {
	vi.stubEnv('AUTUMN_SECRET_KEY', 'am_sk_test_messages_access');
	vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test-messages-access');
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe('aiChat/messages access', () => {
	it('refuses a caller without a session', async () => {
		const t = harness();
		const { threadId } = await signIn(t, 'owner@example.com');

		for (const call of [
			t.mutation(api.aiChat.messages.sendMessage, { threadId, prompt: 'hello' }),
			t.query(api.aiChat.messages.listMessages, {
				threadId,
				paginationOpts: { numItems: 10, cursor: null }
			}),
			t.query(api.aiChat.messages.getFileMetadataBatch, { urls: [] })
		]) {
			await expect(refusal(call)).resolves.toBe('Unauthenticated');
		}
	});

	it('refuses a too long prompt with its maximum before the thread check and any write', async () => {
		const t = harness();
		const owner = await signIn(t, 'owner@example.com');
		const stranger = await signIn(t, 'stranger@example.com');
		const before = await effects(t);

		for (const caller of [owner.caller, stranger.caller]) {
			await expect(
				refusal(
					caller.mutation(api.aiChat.messages.sendMessage, {
						threadId: owner.threadId,
						prompt: 'x'.repeat(MAX_MESSAGE_LENGTH + 1)
					})
				)
			).resolves.toEqual({
				code: AI_CHAT_ERROR_CODES.messageTooLong,
				maxLength: MAX_MESSAGE_LENGTH
			});
		}
		expect(await effects(t)).toEqual(before);
	});

	it('refuses more file ids than the cap before the thread check, the rate limit and any write', async () => {
		const t = harness();
		const owner = await signIn(t, 'owner@example.com');
		const stranger = await signIn(t, 'stranger@example.com');
		const fileId = await storeFile(t);
		for (let i = 0; i < MESSAGE_BURST; i++) {
			await owner.caller.mutation(api.aiChat.messages.sendMessage, {
				threadId: owner.threadId,
				prompt: `own ${i}`
			});
		}
		const before = await effects(t);

		for (const caller of [owner.caller, stranger.caller]) {
			await expect(
				refusal(
					caller.mutation(api.aiChat.messages.sendMessage, {
						threadId: owner.threadId,
						prompt: 'files',
						fileIds: Array(MAX_MESSAGE_FILES + 1).fill(fileId)
					})
				)
			).resolves.toEqual({
				code: AI_CHAT_ERROR_CODES.tooManyFiles,
				maxFiles: MAX_MESSAGE_FILES
			});
		}
		expect(await effects(t)).toEqual(before);
		expect(before.warm).toEqual([stranger.threadId]);
	});

	it('accepts a send with exactly the cap of file ids', async () => {
		const t = harness();
		const { userId, threadId, caller } = await signIn(t, 'files@example.com');
		const fileId = await storeFile(t, userId);

		await expect(
			caller.mutation(api.aiChat.messages.sendMessage, {
				threadId,
				prompt: 'files',
				fileIds: Array(MAX_MESSAGE_FILES).fill(fileId)
			})
		).resolves.toEqual({ messageId: expect.any(String), order: 0 });
		expect((await effects(t)).receipts).toEqual([userId]);
		expect(await fileParts(t, threadId)).toBe(MAX_MESSAGE_FILES);
	});

	it('refuses a file another user uploaded or nobody uploaded, without writes', async () => {
		const t = harness();
		const owner = await signIn(t, 'owner@example.com');
		const other = await signIn(t, 'other@example.com');
		const own = await storeFile(t, owner.userId, 'own');
		const foreign = await storeFile(t, other.userId, 'foreign');
		const ownerless = await storeFile(t, undefined, 'ownerless');
		const before = await effects(t);

		for (const fileIds of [[foreign], [ownerless], [own, foreign]]) {
			await expect(
				refusal(
					owner.caller.mutation(api.aiChat.messages.sendMessage, {
						threadId: owner.threadId,
						prompt: 'files',
						fileIds
					})
				)
			).resolves.toEqual({ code: AI_CHAT_ERROR_CODES.attachmentUnavailable });
		}
		expect(await effects(t)).toEqual(before);
		expect(await fileParts(t, owner.threadId)).toBe(0);
	});

	it.each([
		[
			'component row',
			(t: Harness, fileId: string) =>
				t.mutation(components.agent.files.deleteFiles, { fileIds: [fileId], force: true })
		],
		['storage blob', removeStorageBlob]
	])('refuses an own file whose %s is gone, without writes', async (_gone, remove) => {
		const t = harness();
		const { userId, threadId, caller } = await signIn(t, 'files@example.com');
		const fileId = await storeFile(t, userId);
		await remove(t, fileId);
		const before = await effects(t);

		await expect(
			refusal(
				caller.mutation(api.aiChat.messages.sendMessage, {
					threadId,
					prompt: 'files',
					fileIds: [fileId]
				})
			)
		).resolves.toEqual({ code: AI_CHAT_ERROR_CODES.attachmentUnavailable });
		expect(await effects(t)).toEqual(before);
	});

	it("refuses another user's thread before the rate limit, without writes", async () => {
		const t = harness();
		const owner = await signIn(t, 'owner@example.com');
		const stranger = await signIn(t, 'stranger@example.com');
		for (let i = 0; i < MESSAGE_BURST; i++) {
			await stranger.caller.mutation(api.aiChat.messages.sendMessage, {
				threadId: stranger.threadId,
				prompt: `own ${i}`
			});
		}
		const before = await effects(t);

		await expect(
			refusal(
				stranger.caller.mutation(api.aiChat.messages.sendMessage, {
					threadId: owner.threadId,
					prompt: 'hello'
				})
			)
		).resolves.toEqual({ code: AI_CHAT_ERROR_CODES.threadNotFound });
		await expect(
			refusal(
				stranger.caller.query(api.aiChat.messages.listMessages, {
					threadId: owner.threadId,
					paginationOpts: { numItems: 10, cursor: null }
				})
			)
		).resolves.toEqual({ code: AI_CHAT_ERROR_CODES.threadNotFound });
		expect(await effects(t)).toEqual(before);
		expect(before.warm).toEqual([owner.threadId]);
	});

	it('limits sends per user with the retry delay and leaves the refused send without effect', async () => {
		const t = harness();
		const { threadId, caller } = await signIn(t, 'busy@example.com');
		for (let i = 0; i < MESSAGE_BURST; i++) {
			await caller.mutation(api.aiChat.messages.sendMessage, { threadId, prompt: `hi ${i}` });
		}
		const before = await effects(t);

		const data = await refusal(
			caller.mutation(api.aiChat.messages.sendMessage, { threadId, prompt: 'one more' })
		);
		expect(data).toEqual({ code: 'RATE_LIMITED', retryAfter: expect.any(Number) });
		expect((data as { retryAfter: number }).retryAfter).toBeGreaterThan(0);
		expect(await effects(t)).toEqual(before);
		expect(before.receipts).toHaveLength(MESSAGE_BURST);
	});

	it('schedules the reply for every send and the title only for the first one', async () => {
		const t = harness();
		const { userId, threadId, caller } = await signIn(t, 'sender@example.com');

		const first = await caller.mutation(api.aiChat.messages.sendMessage, {
			threadId,
			prompt: 'First question'
		});
		const second = await caller.mutation(api.aiChat.messages.sendMessage, {
			threadId,
			prompt: 'Follow-up'
		});

		expect(first).toEqual({ messageId: expect.any(String), order: 0 });
		expect(second.order).toBe(1);
		const { receipts, jobs, warm } = await effects(t);
		expect(receipts).toEqual([userId, userId]);
		expect(warm).toEqual([]);
		expect(jobs).toEqual([
			{ name: REPLY, args: { threadId, promptMessageId: first.messageId, userId } },
			{ name: TITLE, args: { threadId, prompt: 'First question', userId } },
			{ name: REPLY, args: { threadId, promptMessageId: second.messageId, userId } }
		]);
		await expect(
			caller.query(api.aiChat.messages.listMessages, {
				threadId,
				paginationOpts: { numItems: 10, cursor: null }
			})
		).resolves.toMatchObject({ page: expect.any(Array) });
	});
});
