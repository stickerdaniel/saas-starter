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
			threads: { updateLastMessage: 'internal.support.threads.updateLastMessage' }
		}
	}
}));

const GET_ACTIVE_REF = 'internal.support.promptStore.getActive';

import { supportAgent } from '../agent';
import { createAIResponse } from '../messages';

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
