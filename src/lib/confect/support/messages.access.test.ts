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
import { MAX_MESSAGE_FILES, MAX_MESSAGE_LENGTH } from '../constants';
import { convexModules, preloadModules } from '../convexTest.modules';
import { FILE_ERROR_CODES } from '../files/errors';
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
const ANONYMOUS_MESSAGES_PER_MINUTE = 3;

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

const agentMessages = async (t: Harness, threadId: string) =>
	(
		await t.query(components.agent.messages.listMessagesByThreadId, {
			threadId,
			order: 'asc',
			paginationOpts: { numItems: 10, cursor: null }
		})
	).page;

const visitorMessages = async (t: Harness, threadId: string) =>
	(await agentMessages(t, threadId)).filter(({ message }) => message?.role === 'user');

const fileParts = async (t: Harness, threadId: string) =>
	(await visitorMessages(t, threadId))
		.flatMap(({ message }) =>
			Array.isArray(message?.content) ? message.content.map((part) => part.type) : []
		)
		.filter((type) => type === 'file').length;

async function storeFile(t: Harness) {
	const storageId = await t.run((ctx) =>
		ctx.storage.store(new Blob(['notes'], { type: 'text/plain' }))
	);
	const { fileId } = await t.mutation(components.agent.files.addFile, {
		storageId,
		hash: 'notes',
		filename: 'notes.txt',
		mediaType: 'text/plain'
	});
	return fileId;
}

async function ownedThread(t: Harness) {
	const { threadId } = await t.mutation(api.support.threads.getOrCreateWarmThread, {
		anonymousUserId: OWNER
	});
	return threadId;
}

const firstPage = { numItems: 10, cursor: null };

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('support message access', () => {
	it('refuses a thread in the order unknown, unauthenticated, foreign', async () => {
		const t = harness();
		const threadId = await ownedThread(t);
		const calls = (args: { threadId: string; anonymousUserId?: string }) => [
			t.query(api.support.messages.listMessages, { ...args, paginationOpts: firstPage }),
			t.mutation(api.support.messages.sendMessage, { ...args, prompt: 'Hello' })
		];

		for (const [args, code] of [
			[{ threadId: 'thread_missing' }, SUPPORT_ERROR_CODES.threadNotFound],
			[{ threadId }, SUPPORT_ERROR_CODES.authenticationRequired],
			[{ threadId, anonymousUserId: STRANGER }, SUPPORT_ERROR_CODES.threadForbidden]
		] as const) {
			for (const call of calls(args)) expect(await refusal(call)).toEqual({ code });
		}
		expect(await agentMessages(t, threadId)).toEqual([]);
	});

	it('lists and accepts messages for the owner', async () => {
		const t = harness();
		const threadId = await ownedThread(t);

		const { messageId } = await t.mutation(api.support.messages.sendMessage, {
			threadId,
			anonymousUserId: OWNER,
			prompt: 'Hello'
		});
		const listed = await t.query(api.support.messages.listMessages, {
			threadId,
			anonymousUserId: OWNER,
			paginationOpts: firstPage
		});

		expect(
			listed.page.filter(({ role }) => role === 'user').map(({ id, text }) => ({ id, text }))
		).toEqual([{ id: messageId, text: 'Hello' }]);
	});

	it('refuses an overlong message with its limit before checking access', async () => {
		const t = harness();
		const threadId = await ownedThread(t);

		for (const args of [
			{ threadId: 'thread_missing' },
			{ threadId },
			{ threadId, anonymousUserId: OWNER }
		]) {
			const call = t.mutation(api.support.messages.sendMessage, {
				...args,
				prompt: 'x'.repeat(MAX_MESSAGE_LENGTH + 1)
			});
			expect(await refusal(call)).toEqual({
				code: SUPPORT_ERROR_CODES.messageTooLong,
				maxLength: MAX_MESSAGE_LENGTH
			});
		}
		expect(await agentMessages(t, threadId)).toEqual([]);
	});

	it('refuses more file ids than the cap before checking access or the rate limit', async () => {
		const t = harness();
		const threadId = await ownedThread(t);
		const fileId = await storeFile(t);
		for (let sent = 0; sent < ANONYMOUS_MESSAGES_PER_MINUTE; sent++) {
			await t.mutation(api.support.messages.sendMessage, {
				threadId,
				anonymousUserId: OWNER,
				prompt: 'Hello'
			});
		}

		for (const args of [
			{ threadId: 'thread_missing' },
			{ threadId },
			{ threadId, anonymousUserId: STRANGER },
			{ threadId, anonymousUserId: OWNER }
		]) {
			const call = t.mutation(api.support.messages.sendMessage, {
				...args,
				prompt: 'Files',
				fileIds: Array(MAX_MESSAGE_FILES + 1).fill(fileId)
			});
			expect(await refusal(call)).toEqual({
				code: SUPPORT_ERROR_CODES.tooManyFiles,
				maxFiles: MAX_MESSAGE_FILES
			});
		}
		expect(await visitorMessages(t, threadId)).toHaveLength(ANONYMOUS_MESSAGES_PER_MINUTE);
		expect(await fileParts(t, threadId)).toBe(0);
	});

	it('accepts a send with exactly the cap of file ids', async () => {
		const t = harness();
		const threadId = await ownedThread(t);
		const fileId = await storeFile(t);

		await expect(
			t.mutation(api.support.messages.sendMessage, {
				threadId,
				anonymousUserId: OWNER,
				prompt: 'Files',
				fileIds: Array(MAX_MESSAGE_FILES).fill(fileId)
			})
		).resolves.toMatchObject({ messageId: expect.any(String) });
		expect(await visitorMessages(t, threadId)).toHaveLength(1);
		expect(await fileParts(t, threadId)).toBe(MAX_MESSAGE_FILES);
	});

	it('refuses an anonymous owner past the per-minute limit with a retry time', async () => {
		const t = harness();
		const threadId = await ownedThread(t);
		const send = () =>
			t.mutation(api.support.messages.sendMessage, {
				threadId,
				anonymousUserId: OWNER,
				prompt: 'Hello'
			});

		for (let sent = 0; sent < ANONYMOUS_MESSAGES_PER_MINUTE; sent++) await send();
		const data = await refusal(send());

		expect(data).toEqual({ code: 'RATE_LIMITED', retryAfter: expect.any(Number) });
		expect(data.retryAfter).toBeGreaterThan(0);
		expect(await visitorMessages(t, threadId)).toHaveLength(ANONYMOUS_MESSAGES_PER_MINUTE);
	});

	it('returns image dimensions without a session', async () => {
		const t = harness();
		const url = 'https://files.test/a.png';
		await t.run((ctx) =>
			ctx.db.insert('fileMetadata', {
				fileId: 'f1',
				storageId: 's1',
				url,
				width: 4,
				height: 3,
				createdAt: 0
			})
		);

		expect(
			await t.query(api.support.messages.getFileMetadataBatch, {
				urls: [url, 'https://files.test/missing.png']
			})
		).toEqual({ [url]: { width: 4, height: 3 } });
		expect(
			await refusal(
				t.query(api.support.messages.getFileMetadataBatch, {
					urls: Array.from({ length: 101 }, (_, index) => `https://files.test/${index}.png`)
				})
			)
		).toEqual({ code: FILE_ERROR_CODES.metadataLimit, maxUrls: 100 });
	});
});
