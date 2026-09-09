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

vi.mock('../aiUsage/record', () => ({ recordAiUsage: vi.fn() }));

vi.mock('../_generated/api', () => ({
	internal: {
		aiChat: {
			threads: { setThreadTitleIfEmpty: 'internal.aiChat.threads.setThreadTitleIfEmpty' }
		}
	}
}));

import { getAutumnSdk } from '../autumn';
import {
	CapabilityConfigurationError,
	requireAiConfiguration,
	requireBillingConfiguration
} from '../env';
import { generateThreadTitle } from './titles';

const getAutumnSdkMock = getAutumnSdk as unknown as ReturnType<typeof vi.fn>;
const requireAiMock = requireAiConfiguration as unknown as ReturnType<typeof vi.fn>;
const requireBillingMock = requireBillingConfiguration as unknown as ReturnType<typeof vi.fn>;

type RegisteredAction = {
	_handler: (
		ctx: { runMutation: ReturnType<typeof vi.fn> },
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

			expect(await handler._handler({ runMutation }, args)).toBeNull();
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

		expect(await handler._handler({ runMutation }, args)).toBeNull();
		expect(generateText).not.toHaveBeenCalled();
		expect(runMutation).not.toHaveBeenCalled();
	});

	it('skips model transport if AI is lost after the entitlement check', async () => {
		requireAiMock.mockReturnValueOnce({ apiKey: 'configured' }).mockImplementationOnce(() => {
			throw new CapabilityConfigurationError('ai', 'misconfigured');
		});
		const runMutation = vi.fn();

		expect(await handler._handler({ runMutation }, args)).toBeNull();
		expect(autumnCheck).toHaveBeenCalledTimes(1);
		expect(generateText).not.toHaveBeenCalled();
		expect(runMutation).not.toHaveBeenCalled();
	});

	it('skips model transport on a definitive ready-provider entitlement denial', async () => {
		autumnCheck.mockResolvedValue({ data: { allowed: false } });
		const runMutation = vi.fn();

		expect(await handler._handler({ runMutation }, args)).toBeNull();
		expect(getAutumnSdkMock).toHaveBeenCalledTimes(1);
		expect(generateText).not.toHaveBeenCalled();
		expect(runMutation).not.toHaveBeenCalled();
	});

	it('preserves fail-open behavior for a ready-provider unavailable response', async () => {
		autumnCheck.mockResolvedValue({ data: null });
		const runMutation = vi.fn().mockResolvedValue(null);

		expect(await handler._handler({ runMutation }, args)).toBeNull();
		expect(generateText).toHaveBeenCalledTimes(1);
		expect(runMutation).toHaveBeenCalledWith('internal.aiChat.threads.setThreadTitleIfEmpty', {
			threadId: 'thread_1',
			title: 'Configure Billing'
		});
	});
});
