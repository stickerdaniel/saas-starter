import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { PUBLISHED_ACTION_NAMES, autumnSdkConstruction, check, trackSdk } = vi.hoisted(() => ({
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
	check: vi.fn(),
	trackSdk: vi.fn()
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
		track = trackSdk;

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

	it('credits the balance with a negative track value', async () => {
		trackSdk.mockResolvedValue({
			data: {
				id: 'event_1',
				code: 'event_received',
				customer_id: 'user_1',
				feature_id: 'ai_chat_messages'
			},
			error: null,
			statusCode: 200
		});

		const outcome = await refundUsage({
			customerId: 'user_1',
			featureId: 'ai_chat_messages'
		});

		expect(outcome).toEqual({ status: 'refunded' });
		expect(trackSdk).toHaveBeenCalledWith({
			customer_id: 'user_1',
			feature_id: 'ai_chat_messages',
			value: -1
		});
	});

	it('reports a non-2xx result without provider or request details', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		trackSdk.mockResolvedValue({
			data: null,
			error: new Error('provider rejected the refund'),
			statusCode: 503
		});

		const outcome = await refundUsage({
			customerId: 'user_1',
			featureId: 'ai_chat_messages',
			value: 2
		});

		expect(outcome).toEqual({ status: 'failed', reason: 'non_2xx', statusCode: 503 });
		expect(trackSdk).toHaveBeenCalledWith(expect.objectContaining({ value: -2 }));
		expect(error).toHaveBeenCalledOnce();
		expect(error).toHaveBeenCalledWith('[refundUsage] Autumn refund failed', outcome);
		error.mockRestore();
	});

	it('reports a thrown exception without masking the caller failure', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		trackSdk.mockRejectedValue(new Error('network down'));

		await expect(
			refundUsage({ customerId: 'user_1', featureId: 'ai_chat_messages', value: 2 })
		).resolves.toEqual({ status: 'failed', reason: 'exception' });

		expect(trackSdk).toHaveBeenCalledWith(expect.objectContaining({ value: -2 }));
		expect(error).toHaveBeenCalledOnce();
		expect(error).toHaveBeenCalledWith('[refundUsage] Autumn refund failed', {
			status: 'failed',
			reason: 'exception'
		});
		error.mockRestore();
	});
});
