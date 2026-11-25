import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../env', () => {
	class CapabilityConfigurationError extends Error {}
	return {
		CapabilityConfigurationError,
		requireAiConfiguration: vi.fn(() => ({ apiKey: 'configured' })),
		requireBillingConfiguration: vi.fn(() => ({ secretKey: 'configured' }))
	};
});

const { autumnCheck, generateText, orModel } = vi.hoisted(() => ({
	autumnCheck: vi.fn(),
	generateText: vi.fn(),
	orModel: vi.fn(() => 'model')
}));

vi.mock('../autumn', () => ({
	getAutumnSdk: vi.fn(async () => ({ check: autumnCheck }))
}));

vi.mock('ai', () => ({ generateText }));

vi.mock('../aiUsage/capture', () => ({
	orModel,
	captureDirect: vi.fn(() => ({ model: 'model' }))
}));

vi.mock('../aiUsage/record.impl', async (importOriginal) => {
	const { void: done } = await import('effect/Effect');
	return { ...(await importOriginal<object>()), recordAiUsage: vi.fn(() => done) };
});

import { getFunctionName } from 'convex/server';
import { getAutumnSdk } from '../autumn';
import {
	CapabilityConfigurationError,
	requireAiConfiguration,
	requireBillingConfiguration
} from '../env';
import { generateThreadTitle } from '../../convex/aiChat/titles';
import { recordAiUsage } from '../aiUsage/record.impl';

const getAutumnSdkMock = getAutumnSdk as unknown as ReturnType<typeof vi.fn>;
const requireAiMock = requireAiConfiguration as unknown as ReturnType<typeof vi.fn>;
const requireBillingMock = requireBillingConfiguration as unknown as ReturnType<typeof vi.fn>;

type ActionFake = {
	runMutation: ReturnType<typeof vi.fn>;
	runQuery: ReturnType<typeof vi.fn>;
	runAction: ReturnType<typeof vi.fn>;
	vectorSearch: ReturnType<typeof vi.fn>;
};

const actionCtx = (runMutation: ReturnType<typeof vi.fn>): ActionFake => ({
	runMutation,
	runQuery: vi.fn(),
	runAction: vi.fn(),
	vectorSearch: vi.fn()
});

type RegisteredAction = {
	_handler: (
		ctx: ActionFake,
		args: { threadId: string; prompt: string; userId?: string }
	) => Promise<null>;
};

const handler = generateThreadTitle as unknown as RegisteredAction;
const args = { threadId: 'thread_1', prompt: 'How do I configure billing?', userId: 'user_1' };

describe('generateThreadTitle', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		requireAiMock.mockReturnValue({ apiKey: 'configured' });
		requireBillingMock.mockReturnValue({ secretKey: 'configured' });
		getAutumnSdkMock.mockResolvedValue({ check: autumnCheck });
		autumnCheck.mockResolvedValue({ data: { allowed: true } });
		generateText.mockResolvedValue({
			text: 'Configure Billing',
			usage: {},
			providerMetadata: {}
		});
	});

	it.each([requireBillingMock, requireAiMock])(
		'skips queued work before SDK, model, or writes when configuration is not ready',
		async (requireConfiguration) => {
			requireConfiguration.mockImplementationOnce(() => {
				throw new CapabilityConfigurationError('ai', 'misconfigured');
			});
			const runMutation = vi.fn();

			expect(await handler._handler(actionCtx(runMutation), args)).toBeNull();
			expect(getAutumnSdkMock).not.toHaveBeenCalled();
			expect(orModel).not.toHaveBeenCalled();
			expect(generateText).not.toHaveBeenCalled();
			expect(runMutation).not.toHaveBeenCalled();
		}
	);

	it('returns without transport or writes if billing is lost during revalidation', async () => {
		getAutumnSdkMock.mockRejectedValue(
			new CapabilityConfigurationError('billing', 'misconfigured')
		);
		const runMutation = vi.fn();

		expect(await handler._handler(actionCtx(runMutation), args)).toBeNull();
		expect(generateText).not.toHaveBeenCalled();
		expect(runMutation).not.toHaveBeenCalled();
	});

	it('skips model transport if AI is lost after the entitlement check', async () => {
		requireAiMock.mockReturnValueOnce({ apiKey: 'configured' }).mockImplementationOnce(() => {
			throw new CapabilityConfigurationError('ai', 'misconfigured');
		});
		const runMutation = vi.fn();

		expect(await handler._handler(actionCtx(runMutation), args)).toBeNull();
		expect(autumnCheck).toHaveBeenCalledTimes(1);
		expect(generateText).not.toHaveBeenCalled();
		expect(runMutation).not.toHaveBeenCalled();
	});

	it('skips model transport on a definitive ready-provider entitlement denial', async () => {
		autumnCheck.mockResolvedValue({ data: { allowed: false } });
		const runMutation = vi.fn();

		expect(await handler._handler(actionCtx(runMutation), args)).toBeNull();
		expect(getAutumnSdkMock).toHaveBeenCalledTimes(1);
		expect(generateText).not.toHaveBeenCalled();
		expect(runMutation).not.toHaveBeenCalled();
	});

	it('preserves fail-open behavior for a ready-provider unavailable response', async () => {
		autumnCheck.mockResolvedValue({ data: null });
		const runMutation = vi.fn().mockResolvedValue(null);

		expect(await handler._handler(actionCtx(runMutation), args)).toBeNull();
		expect(generateText).toHaveBeenCalledTimes(1);
		expect(runMutation).toHaveBeenCalledTimes(1);
		const [ref, input] = runMutation.mock.calls[0];
		expect([getFunctionName(ref), input]).toEqual([
			'aiChat/threads:setThreadTitleIfEmpty',
			{ threadId: 'thread_1', title: 'Configure Billing' }
		]);
	});

	it('writes the first line without wrapping quotes, clamped to 60 characters', async () => {
		generateText.mockResolvedValue({
			text: `"${'A'.repeat(70)}"\nSecond line`,
			usage: {},
			providerMetadata: {}
		});
		const runMutation = vi.fn().mockResolvedValue(null);

		expect(await handler._handler(actionCtx(runMutation), args)).toBeNull();
		expect(runMutation.mock.calls[0]?.[1]).toEqual({ threadId: 'thread_1', title: 'A'.repeat(60) });
		expect(recordAiUsage).toHaveBeenCalledWith({
			feature: 'ai_chat_title',
			userId: 'user_1',
			models: [{ model: 'model' }]
		});
	});

	it('skips the write when the model call fails', async () => {
		generateText.mockRejectedValue(new Error('provider down'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const runMutation = vi.fn();

		expect(await handler._handler(actionCtx(runMutation), args)).toBeNull();
		expect(warn).toHaveBeenCalledWith({ code: 'ai_chat_title_failed' });
		expect(runMutation).not.toHaveBeenCalled();
		expect(recordAiUsage).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	it('skips the entitlement check for a thread without a user', async () => {
		const runMutation = vi.fn().mockResolvedValue(null);

		expect(
			await handler._handler(actionCtx(runMutation), {
				threadId: 'thread_1',
				prompt: 'Hello there'
			})
		).toBeNull();
		expect(autumnCheck).not.toHaveBeenCalled();
		expect(runMutation).toHaveBeenCalledTimes(1);
	});
});
