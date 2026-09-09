import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { PUBLISHED_ACTION_NAMES, autumnSdkConstruction, check } = vi.hoisted(() => ({
	PUBLISHED_ACTION_NAMES: [
		'track',
		'cancel',
		'query',
		'attach',
		'check',
		'checkout',
		'usage',
		'setupPayment',
		'createCustomer',
		'listProducts',
		'billingPortal',
		'createReferralCode',
		'redeemReferralCode',
		'createEntity',
		'getEntity'
	] as const,
	autumnSdkConstruction: vi.fn(),
	check: vi.fn()
}));

vi.mock('../auth', () => ({
	authComponent: {
		getAuthUser: vi.fn().mockResolvedValue({
			_id: 'user_1',
			name: 'Test User',
			email: 'user@example.com'
		})
	}
}));

vi.mock('../_generated/api', () => ({
	components: { autumn: {} },
	internal: {}
}));

vi.mock('@useautumn/convex', () => ({
	Autumn: class {
		options: { identify: (ctx: unknown) => unknown; secretKey: string; url?: string };

		constructor(
			_publicComponent: unknown,
			options: { identify: (ctx: unknown) => unknown; secretKey: string; url?: string }
		) {
			this.options = options;
		}

		async getAuthParams(_args?: unknown) {
			autumnSdkConstruction(this.options.secretKey);
			return { autumn: {}, identifierOpts: {} };
		}

		api() {
			return Object.fromEntries(
				PUBLISHED_ACTION_NAMES.map((name) => [
					name,
					{
						_handler: async (ctx: unknown) => {
							await this.getAuthParams({ ctx });
							return null;
						}
					}
				])
			);
		}
	}
}));

vi.mock('autumn-js', () => ({
	Autumn: class {
		check = check;

		constructor(options: { secretKey: string }) {
			autumnSdkConstruction(options.secretKey);
		}
	}
}));

import * as autumnModule from '../autumn';
import { checkAndCountUsage, getAutumnSdk, refundUsage } from '../autumn';

function setReadyBilling() {
	vi.stubEnv('AUTUMN_SECRET_KEY', 'configured-autumn-key');
}

function registeredAction(value: unknown) {
	return value as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };
}

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe('published Autumn actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('keeps the complete published action surface guarded', async () => {
		vi.stubEnv('AUTUMN_SECRET_KEY', 'am_sk_local_e2e_dummy');

		for (const name of PUBLISHED_ACTION_NAMES) {
			await expect(registeredAction(autumnModule[name])._handler({}, {})).rejects.toThrow(
				'[capability] billing is misconfigured'
			);
		}

		expect(autumnSdkConstruction).not.toHaveBeenCalled();
	});

	it('constructs autumn-js only after a ready action reaches getAuthParams', async () => {
		setReadyBilling();

		await registeredAction(autumnModule.check)._handler({}, {});

		expect(autumnSdkConstruction).toHaveBeenCalledTimes(1);
		expect(autumnSdkConstruction).toHaveBeenCalledWith('configured-autumn-key');
	});
});

describe('getAutumnSdk', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each([
		{ state: 'disabled' as const },
		{ state: 'misconfigured' as const, issue: 'missing' as const }
	])('does not import or construct the SDK for $state configuration', async (configuration) => {
		await expect(getAutumnSdk(configuration)).rejects.toThrow(
			`[capability] billing is ${configuration.state}`
		);
		expect(autumnSdkConstruction).not.toHaveBeenCalled();
	});
});

describe('checkAndCountUsage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setReadyBilling();
	});

	it('sends an atomic check and maps allowed to counted', async () => {
		check.mockResolvedValue({ data: { allowed: true } });

		const outcome = await checkAndCountUsage({ customerId: 'user_1', featureId: 'messages' });

		expect(outcome).toBe('counted');
		expect(check).toHaveBeenCalledWith({
			customer_id: 'user_1',
			feature_id: 'messages',
			required_balance: 1,
			send_event: true
		});
	});

	it('maps a definitive not-allowed response to denied', async () => {
		check.mockResolvedValue({ data: { allowed: false } });

		expect(await checkAndCountUsage({ customerId: 'user_1', featureId: 'messages' })).toBe(
			'denied'
		);
	});

	it('fails closed without SDK construction when billing is misconfigured', async () => {
		vi.stubEnv('AUTUMN_SECRET_KEY', 'am_sk_local_e2e_dummy');

		expect(await checkAndCountUsage({ customerId: 'user_1', featureId: 'messages' })).toBe(
			'denied'
		);
		expect(autumnSdkConstruction).not.toHaveBeenCalled();
		expect(check).not.toHaveBeenCalled();
	});

	it('maps a missing data payload after a ready attempt to unavailable', async () => {
		check.mockResolvedValue({ data: null });

		expect(await checkAndCountUsage({ customerId: 'user_1', featureId: 'messages' })).toBe(
			'unavailable'
		);
		expect(autumnSdkConstruction).toHaveBeenCalledTimes(1);
	});

	it('maps a thrown provider error after a ready attempt to unavailable', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		check.mockRejectedValue(new Error('network down'));

		expect(await checkAndCountUsage({ customerId: 'user_1', featureId: 'messages' })).toBe(
			'unavailable'
		);
		expect(autumnSdkConstruction).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});

	it('passes a custom value as the deducted amount', async () => {
		check.mockResolvedValue({ data: { allowed: true } });

		await checkAndCountUsage({ customerId: 'user_1', featureId: 'messages', value: 3 });

		expect(check).toHaveBeenCalledWith(expect.objectContaining({ required_balance: 3 }));
	});
});

describe('refundUsage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setReadyBilling();
	});

	it('posts a negative usage event with the Autumn API contract', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
		vi.stubGlobal('fetch', fetchMock);

		const outcome = await refundUsage({
			customerId: 'user_1',
			featureId: 'ai_chat_messages'
		});

		expect(outcome).toEqual({ status: 'refunded' });
		expect(autumnSdkConstruction).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(fetchMock).toHaveBeenCalledWith('https://api.useautumn.com/v1/track', {
			method: 'POST',
			headers: {
				Authorization: 'Bearer configured-autumn-key',
				'Content-Type': 'application/json',
				'x-api-version': '1.2'
			},
			body: JSON.stringify({
				customer_id: 'user_1',
				feature_id: 'ai_chat_messages',
				value: -1
			})
		});
		expect(error).not.toHaveBeenCalled();
		error.mockRestore();
	});

	it('does not read or log a provider-controlled non-2xx body', async () => {
		const providerMessage = 'provider rejected refund for user_1';
		const response = new Response(providerMessage, { status: 503 });
		const fetchMock = vi.fn().mockResolvedValue(response);
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.stubGlobal('fetch', fetchMock);

		const outcome = await refundUsage({
			customerId: 'user_1',
			featureId: 'ai_chat_messages',
			value: 2
		});

		expect(outcome).toEqual({ status: 'failed', reason: 'non_2xx', statusCode: 503 });
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(response.bodyUsed).toBe(false);
		expect(error).toHaveBeenCalledOnce();
		expect(error).toHaveBeenCalledWith('[refundUsage] Autumn refund failed', outcome);
		expect(error.mock.calls.flat().map(String).join(' ')).not.toContain(providerMessage);
		error.mockRestore();
	});

	it('does not log a raw thrown fetch failure or mask the caller failure', async () => {
		const providerError = new Error('raw transport failure for user_1');
		const fetchMock = vi.fn().mockRejectedValue(providerError);
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			refundUsage({ customerId: 'user_1', featureId: 'ai_chat_messages', value: 2 })
		).resolves.toEqual({ status: 'failed', reason: 'exception' });

		expect(fetchMock).toHaveBeenCalledOnce();
		expect(error).toHaveBeenCalledOnce();
		expect(error).toHaveBeenCalledWith('[refundUsage] Autumn refund failed', {
			status: 'failed',
			reason: 'exception'
		});
		expect(error.mock.calls.flat()).not.toContain(providerError);
		expect(error.mock.calls.flat().map(String).join(' ')).not.toContain(providerError.message);
		error.mockRestore();
	});
});
