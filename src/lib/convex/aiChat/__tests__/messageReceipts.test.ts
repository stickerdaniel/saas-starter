import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../auth', () => ({
	authComponent: {
		getAuthUser: vi.fn().mockResolvedValue({ _id: 'sender' }),
		safeGetAuthUser: vi.fn()
	}
}));

vi.mock('../../autumn', () => ({
	checkAndCountUsage: vi.fn().mockResolvedValue('counted'),
	refundUsage: vi.fn().mockResolvedValue('refunded')
}));

vi.mock('../../env', () => {
	class CapabilityConfigurationError extends Error {}
	return {
		CapabilityConfigurationError,
		requireAiConfiguration: vi.fn(() => ({ apiKey: 'configured' })),
		requireBillingConfiguration: vi.fn(() => ({ secretKey: 'configured' }))
	};
});

vi.mock('../agent', () => ({
	aiChatAgent: {
		saveMessage: vi.fn().mockResolvedValue({ messageId: 'user_message' }),
		streamText: vi.fn()
	}
}));

vi.mock('../rateLimit', () => ({
	aiChatRateLimiter: { limit: vi.fn() }
}));

vi.mock('../ownership', () => ({
	requireAiChatThreadRecord: vi.fn()
}));

vi.mock('@convex-dev/agent', () => ({
	getFile: vi.fn().mockResolvedValue({ filePart: { type: 'file', data: 'f', mediaType: 'x' } }),
	saveMessage: vi.fn().mockResolvedValue({ messageId: 'notice' })
}));

import { aiChatAgent } from '../agent';
import { aiChatRateLimiter } from '../rateLimit';
import { requireAiChatThreadRecord } from '../ownership';
import { createAIResponse, sendMessage } from '../messages';
import { MAX_MESSAGE_LENGTH } from '../../constants';
import { createJourneyStore } from '../../admin/journey/journeyStore.fixtures';

type Registered = { _handler: (ctx: never, args: never) => Promise<unknown> };

const limitMock = aiChatRateLimiter.limit as unknown as ReturnType<typeof vi.fn>;
const requireThreadMock = requireAiChatThreadRecord as unknown as ReturnType<typeof vi.fn>;
const streamTextMock = aiChatAgent.streamText as unknown as ReturnType<typeof vi.fn>;

function setup() {
	const store = createJourneyStore();
	const threadRecordId = store.insert('aiChatThreads', {
		threadId: 'thread_1',
		userId: 'sender',
		createdAt: 0,
		isWarm: false
	});
	requireThreadMock.mockImplementation(async () => store.docs('aiChatThreads')[0]);
	const send = (args: { prompt: string; fileIds?: string[] }) =>
		store.mutate(sendMessage as unknown as Registered, { threadId: 'thread_1', ...args });
	const receipts = () => store.docs('aiChatMessageReceipts').map((row) => row.userId);
	return { store, threadRecordId, send, receipts };
}

beforeEach(() => {
	limitMock.mockResolvedValue({ ok: true, retryAfter: 0 });
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('AI chat message receipts', () => {
	it.each([
		['a text message', { prompt: 'hello' }],
		['a message with files', { prompt: '', fileIds: ['file_1', 'file_2'] }]
	])('records exactly one receipt for %s', async (_label, args) => {
		const { store, send, receipts } = setup();

		await send(args);

		expect(receipts()).toEqual(['sender']);
		expect(store.docs('journeyCaptureStarts').map((row) => row.source)).toEqual(['aiChat']);
	});

	it('records nothing for a rejected message', async () => {
		const { send, receipts } = setup();

		await expect(send({ prompt: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) })).rejects.toThrow();

		expect(receipts()).toEqual([]);
	});

	it('records nothing for a rate-limited message', async () => {
		const { send, receipts } = setup();
		limitMock.mockResolvedValue({ ok: false, retryAfter: 1_000 });

		await expect(send({ prompt: 'hello' })).rejects.toThrow();

		expect(receipts()).toEqual([]);
	});

	it('records nothing when the send rolls back after saving', async () => {
		const { store, threadRecordId, send, receipts } = setup();
		store.failWrites(threadRecordId);

		await expect(send({ prompt: 'hello' })).rejects.toThrow();

		expect(receipts()).toEqual([]);
		expect(store.docs('journeyCaptureStarts')).toEqual([]);
	});

	it('keeps the receipt when the AI reply later fails', async () => {
		const { store, send, receipts } = setup();
		await send({ prompt: 'hello' });
		streamTextMock.mockRejectedValue(new Error('provider down'));

		await expect(
			(createAIResponse as unknown as Registered)._handler(
				store.actionCtx() as never,
				{ threadId: 'thread_1', promptMessageId: 'user_message', userId: 'sender' } as never
			)
		).rejects.toThrow('provider down');

		expect(receipts()).toEqual(['sender']);
	});
});
