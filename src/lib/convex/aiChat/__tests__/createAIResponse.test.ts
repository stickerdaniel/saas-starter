import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../auth', () => ({
	authComponent: {
		getAuthUser: vi.fn(),
		safeGetAuthUser: vi.fn()
	}
}));

vi.mock('../../autumn', () => ({
	checkAndCountUsage: vi.fn(),
	refundUsage: vi.fn().mockResolvedValue(undefined)
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
		saveMessage: vi.fn(),
		streamText: vi.fn()
	}
}));

vi.mock('../rateLimit', () => ({
	aiChatRateLimiter: {
		limit: vi.fn().mockResolvedValue({ ok: true, retryAfter: 0 })
	}
}));

vi.mock('../ownership', () => ({
	requireAiChatThreadRecord: vi.fn()
}));

vi.mock('../../support/messageListing', () => ({
	listMessagesForThread: vi.fn()
}));

vi.mock('@convex-dev/agent', () => ({
	getFile: vi.fn(),
	saveMessage: vi.fn().mockResolvedValue({ messageId: 'notice_1' })
}));

vi.mock('@convex-dev/agent/validators', async () => {
	const { v } = await import('convex/values');
	return { vStreamArgs: v.optional(v.any()) };
});

vi.mock('../../_generated/api', () => ({
	components: { agent: {} },
	internal: {
		aiChat: {
			threads: {
				updateThreadMetadata: 'internal.aiChat.threads.updateThreadMetadata'
			},
			messages: {
				createAIResponse: 'internal.aiChat.messages.createAIResponse'
			}
		}
	}
}));

import { checkAndCountUsage, refundUsage } from '../../autumn';
import {
	CapabilityConfigurationError,
	requireAiConfiguration,
	requireBillingConfiguration
} from '../../env';
import { authComponent } from '../../auth';
import { saveMessage } from '@convex-dev/agent';
import { aiChatAgent } from '../agent';
import { requireAiChatThreadRecord } from '../ownership';
import { createAIResponse, sendMessage } from '../messages';
import {
	prepareToolErrorRedactionStep,
	toolErrorRedactionTransform
} from '../../../chat/core/tool-error-redaction';

const checkAndCountUsageMock = checkAndCountUsage as unknown as ReturnType<typeof vi.fn>;
const refundUsageMock = refundUsage as unknown as ReturnType<typeof vi.fn>;
const saveMessageMock = saveMessage as unknown as ReturnType<typeof vi.fn>;
const streamTextMock = aiChatAgent.streamText as unknown as ReturnType<typeof vi.fn>;
const agentSaveMessageMock = aiChatAgent.saveMessage as unknown as ReturnType<typeof vi.fn>;
const requireAiMock = requireAiConfiguration as unknown as ReturnType<typeof vi.fn>;
const requireBillingMock = requireBillingConfiguration as unknown as ReturnType<typeof vi.fn>;
const requireThreadMock = requireAiChatThreadRecord as unknown as ReturnType<typeof vi.fn>;
const getAuthUserMock = authComponent.getAuthUser as unknown as ReturnType<typeof vi.fn>;

type RegisteredFunction<TArgs> = {
	_handler: (ctx: unknown, args: TArgs) => Promise<unknown>;
};

const handler = createAIResponse as unknown as RegisteredFunction<{
	threadId: string;
	promptMessageId: string;
	userId?: string;
}>;

const args = { threadId: 'thread_1', promptMessageId: 'prompt_1', userId: 'user_1' };

// The AI chat usage unit is counted atomically BEFORE the multi-second
// stream (see checkAndCountUsage), so the failure path must refund it:
// a failed generation never costs a message, and a delivered response
// is never refunded by later denormalization errors.
describe('createAIResponse', () => {
	let runMutation: ReturnType<typeof vi.fn>;
	let ctx: { runMutation: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		vi.clearAllMocks();
		requireAiMock.mockReturnValue({ apiKey: 'configured' });
		requireBillingMock.mockReturnValue({ secretKey: 'configured' });
		refundUsageMock.mockResolvedValue(undefined);
		saveMessageMock.mockResolvedValue({ messageId: 'notice_1' });
		runMutation = vi.fn().mockResolvedValue(null);
		ctx = { runMutation };
		streamTextMock.mockResolvedValue({
			consumeStream: vi.fn().mockResolvedValue(undefined),
			text: Promise.resolve('Hello there')
		});
	});

	it('persists a terminal notice when the quota is denied', async () => {
		checkAndCountUsageMock.mockResolvedValue('denied');
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await handler._handler(ctx, args);

		expect(streamTextMock).not.toHaveBeenCalled();
		expect(refundUsageMock).not.toHaveBeenCalled();
		expect(saveMessageMock).toHaveBeenCalledTimes(1);
		expect(saveMessageMock.mock.calls[0][2]).toMatchObject({
			threadId: 'thread_1',
			message: { role: 'assistant' },
			metadata: {
				provider: 'system',
				providerMetadata: { system: { notice: 'ai_chat_limit_reached' } }
			}
		});
		warn.mockRestore();
	});

	it('persists a terminal notice when queued work loses provider configuration', async () => {
		requireAiMock.mockImplementationOnce(() => {
			throw new CapabilityConfigurationError('ai', 'misconfigured');
		});

		await handler._handler(ctx, args);

		expect(checkAndCountUsageMock).not.toHaveBeenCalled();
		expect(streamTextMock).not.toHaveBeenCalled();
		expect(saveMessageMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.objectContaining({
				threadId: 'thread_1',
				message: { role: 'assistant', content: expect.stringContaining('AI is unavailable') }
			})
		);
	});

	it('refunds and terminates if AI is lost after billing succeeds', async () => {
		checkAndCountUsageMock.mockResolvedValue('counted');
		requireAiMock.mockReturnValueOnce({ apiKey: 'configured' }).mockImplementationOnce(() => {
			throw new CapabilityConfigurationError('ai', 'misconfigured');
		});

		await handler._handler(ctx, args);

		expect(refundUsageMock).toHaveBeenCalledWith({
			customerId: 'user_1',
			featureId: 'ai_chat_messages'
		});
		expect(streamTextMock).not.toHaveBeenCalled();
		expect(saveMessageMock).toHaveBeenCalled();
	});

	it('generates and keeps the counted unit on success', async () => {
		checkAndCountUsageMock.mockResolvedValue('counted');

		await handler._handler(ctx, args);

		expect(checkAndCountUsageMock).toHaveBeenCalledWith({
			customerId: 'user_1',
			featureId: 'ai_chat_messages'
		});
		expect(streamTextMock).toHaveBeenCalled();
		expect(streamTextMock.mock.calls[0][2]).toMatchObject({
			prepareStep: prepareToolErrorRedactionStep,
			experimental_transform: toolErrorRedactionTransform
		});
		expect(refundUsageMock).not.toHaveBeenCalled();
		expect(runMutation).toHaveBeenCalledWith(
			'internal.aiChat.threads.updateThreadMetadata',
			expect.objectContaining({ threadId: 'thread_1', lastMessage: 'Hello there' })
		);
	});

	it('refunds the counted unit when generation fails', async () => {
		checkAndCountUsageMock.mockResolvedValue('counted');
		streamTextMock.mockRejectedValue(new Error('model exploded'));

		await expect(handler._handler(ctx, args)).rejects.toThrow('model exploded');

		expect(refundUsageMock).toHaveBeenCalledWith({
			customerId: 'user_1',
			featureId: 'ai_chat_messages'
		});
	});

	it('does not refund a failed generation that was never counted (outage)', async () => {
		checkAndCountUsageMock.mockResolvedValue('unavailable');
		streamTextMock.mockRejectedValue(new Error('model exploded'));

		await expect(handler._handler(ctx, args)).rejects.toThrow('model exploded');

		// Fail-open path: generation ran uncounted, so there is nothing to credit back
		expect(refundUsageMock).not.toHaveBeenCalled();
	});

	it('does not refund when only denormalization fails after a delivered response', async () => {
		checkAndCountUsageMock.mockResolvedValue('counted');
		runMutation.mockRejectedValue(new Error('metadata write failed'));

		await expect(handler._handler(ctx, args)).rejects.toThrow('metadata write failed');

		// The stream was consumed, the response is saved: the unit is earned
		expect(refundUsageMock).not.toHaveBeenCalled();
	});

	it('skips entitlement lookup without a userId after static configuration passes', async () => {
		await handler._handler(ctx, { threadId: 'thread_1', promptMessageId: 'prompt_1' });

		expect(requireBillingMock).toHaveBeenCalled();
		expect(requireAiMock).toHaveBeenCalled();
		expect(checkAndCountUsageMock).not.toHaveBeenCalled();
		expect(streamTextMock).toHaveBeenCalled();
	});
});

describe('sendMessage provider preflight', () => {
	const sendHandler = sendMessage as unknown as RegisteredFunction<{
		threadId: string;
		prompt: string;
	}>;

	beforeEach(() => {
		vi.clearAllMocks();
		getAuthUserMock.mockResolvedValue({ _id: 'user_1' });
		requireThreadMock.mockResolvedValue({
			_id: 'record_1',
			isWarm: false,
			lastMessageAt: undefined
		});
		requireAiMock.mockReturnValue({ apiKey: 'configured' });
		requireBillingMock.mockReturnValue({ secretKey: 'configured' });
		agentSaveMessageMock.mockResolvedValue({ messageId: 'message_1' });
	});

	it.each([requireBillingMock, requireAiMock])(
		'does not save or schedule when a required provider is not ready',
		async (requireConfiguration) => {
			requireConfiguration.mockImplementationOnce(() => {
				throw new CapabilityConfigurationError('ai', 'misconfigured');
			});
			const patch = vi.fn();
			const runAfter = vi.fn();
			const ctx = { db: { patch }, scheduler: { runAfter } };

			await expect(
				sendHandler._handler(ctx, { threadId: 'thread_1', prompt: 'hello' })
			).rejects.toThrow(CapabilityConfigurationError);
			expect(agentSaveMessageMock).not.toHaveBeenCalled();
			expect(patch).not.toHaveBeenCalled();
			expect(runAfter).not.toHaveBeenCalled();
		}
	);
});
