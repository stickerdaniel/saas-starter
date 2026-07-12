import { beforeEach, describe, expect, it, vi } from 'vitest';

// createAIResponse pulls in the whole support module graph at import. Stub the
// heavy or env-dependent siblings so this stays a handler-level unit test that
// only exercises the prompt-override wiring into streamText.
vi.mock('../agent', () => ({
	supportAgent: {
		streamText: vi.fn(),
		saveMessage: vi.fn()
	}
}));

vi.mock('../rateLimit', () => ({
	supportRateLimiter: {
		limit: vi.fn().mockResolvedValue({ ok: true, retryAfter: 0 })
	}
}));

vi.mock('../types', () => ({
	createRateLimitError: vi.fn(() => new Error('rate limited'))
}));

vi.mock('../../i18n/translations', () => ({
	t: vi.fn(() => 'translated'),
	extractLocaleFromUrl: vi.fn(() => 'en')
}));

vi.mock('../ownership', () => ({
	requireSupportThreadAccess: vi.fn()
}));

vi.mock('../messageListing', () => ({
	listMessagesForThread: vi.fn()
}));

vi.mock('../threads', () => ({
	syncSupportLastMessage: vi.fn()
}));

vi.mock('../../files/metadata', () => ({
	getFileMetadataByUrls: vi.fn()
}));

vi.mock('../../aiUsage/agentUsage', () => ({
	makeAgentUsageSink: vi.fn(() => ({ usageHandler: vi.fn(), collect: () => [] }))
}));

vi.mock('../../aiUsage/record', () => ({
	recordAiUsage: vi.fn()
}));

vi.mock('../../constants', () => ({ MAX_MESSAGE_LENGTH: 4000 }));

vi.mock('@convex-dev/agent', () => ({ getFile: vi.fn() }));

vi.mock('@convex-dev/agent/validators', async () => {
	const { v } = await import('convex/values');
	return { vStreamArgs: v.optional(v.any()) };
});

// Ref strings are inlined here because vi.mock factories are hoisted above any
// module-scope const. The same literals are re-declared below for the assertions.
vi.mock('../../_generated/api', () => ({
	components: {},
	internal: {
		support: {
			promptStore: { getActive: 'internal.support.promptStore.getActive' },
			threads: { updateLastMessage: 'internal.support.threads.updateLastMessage' },
			messages: { createAIResponse: 'internal.support.messages.createAIResponse' }
		},
		admin: {
			support: {
				notifications: {
					scheduleAdminNotification:
						'internal.admin.support.notifications.scheduleAdminNotification'
				}
			}
		}
	}
}));

const GET_ACTIVE_REF = 'internal.support.promptStore.getActive';

import { getFile } from '@convex-dev/agent';
import { supportAgent } from '../agent';
import { requireSupportThreadAccess } from '../ownership';
import { createAIResponse, sendMessage } from '../messages';

const streamTextMock = supportAgent.streamText as unknown as ReturnType<typeof vi.fn>;

type Fn<A, R> = { _handler: (ctx: unknown, args: A) => Promise<R> };
const handler = createAIResponse as unknown as Fn<
	{ threadId: string; promptMessageId: string; userId?: string },
	null
>;

const args = { threadId: 'thread_1', promptMessageId: 'prompt_1', userId: 'user_1' };

function makeCtx(override: string | null) {
	return {
		runQuery: vi.fn(async (ref: string) => (ref === GET_ACTIVE_REF ? override : undefined)),
		runMutation: vi.fn().mockResolvedValue(null)
	};
}

describe('createAIResponse prompt override wiring', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		streamTextMock.mockResolvedValue({
			consumeStream: vi.fn().mockResolvedValue(undefined)
		});
	});

	it('passes the active stored prompt to streamText as the system override', async () => {
		const ctx = makeCtx('stored override prompt');

		await handler._handler(ctx, args);

		expect(ctx.runQuery).toHaveBeenCalledWith(GET_ACTIVE_REF, {});
		expect(streamTextMock).toHaveBeenCalledTimes(1);
		expect(streamTextMock.mock.calls[0][2]).toEqual({
			promptMessageId: 'prompt_1',
			system: 'stored override prompt'
		});
	});

	it('leaves system undefined so the seed prompt stands when none is active', async () => {
		const ctx = makeCtx(null);

		await handler._handler(ctx, args);

		expect(streamTextMock.mock.calls[0][2]).toEqual({
			promptMessageId: 'prompt_1',
			system: undefined
		});
	});
});

// The component keeps a file alive only while a stored message references it via
// message.fileIds; the vacuum deletes any file whose refcount is 0. sendMessage
// therefore has to forward the attached fileIds as saveMessage metadata, and only
// for the multimodal branch — a plain text message must not carry a fileIds key.
describe('sendMessage attachment refcount metadata', () => {
	const requireAccessMock = requireSupportThreadAccess as unknown as ReturnType<typeof vi.fn>;
	const saveMessageMock = supportAgent.saveMessage as unknown as ReturnType<typeof vi.fn>;
	const getFileMock = getFile as unknown as ReturnType<typeof vi.fn>;

	const sendHandler = sendMessage as unknown as Fn<
		{ threadId: string; prompt: string; fileIds?: string[] },
		{ messageId: string }
	>;

	function makeSendCtx() {
		return {
			db: { patch: vi.fn() },
			scheduler: { runAfter: vi.fn() }
		};
	}

	beforeEach(() => {
		vi.clearAllMocks();
		requireAccessMock.mockResolvedValue({
			owner: { ownerId: 'user_1', isAnonymous: false },
			supportThread: {
				_id: 'st_1',
				status: 'open',
				isWarm: false,
				isHandedOff: false,
				pageUrl: ''
			}
		});
		saveMessageMock.mockResolvedValue({ messageId: 'm1' });
		getFileMock.mockResolvedValue({
			filePart: {
				type: 'file',
				data: new URL('https://files/f1'),
				mediaType: 'image/png',
				filename: 'f1.png'
			}
		});
	});

	it('forwards fileIds as saveMessage metadata for a multimodal message', async () => {
		const ctx = makeSendCtx();

		await sendHandler._handler(ctx, { threadId: 't1', prompt: 'hi', fileIds: ['file_1'] });

		// Agent instance method signature is saveMessage(ctx, args), so the args
		// object is the second positional argument.
		expect(saveMessageMock.mock.calls[0][1].metadata).toEqual({ fileIds: ['file_1'] });
	});

	it('does not attach metadata for a text-only message', async () => {
		const ctx = makeSendCtx();

		await sendHandler._handler(ctx, { threadId: 't1', prompt: 'hi' });

		expect(saveMessageMock.mock.calls[0][1].metadata).toBeUndefined();
	});
});
