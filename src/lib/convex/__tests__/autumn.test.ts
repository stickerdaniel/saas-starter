import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../env', () => ({
	requireEnv: vi.fn(() => 'sk_test')
}));

vi.mock('../auth', () => ({
	authComponent: {
		getAuthUser: vi.fn()
	}
}));

vi.mock('../_generated/api', () => ({
	components: { autumn: {} },
	internal: {}
}));

vi.mock('@useautumn/convex', () => ({
	Autumn: class {
		api() {
			return {};
		}
	}
}));

const check = vi.fn();
const track = vi.fn();

// The autumn-js factory only runs when getAutumnSdk() dynamically
// imports it inside a test, so the mocks above are initialized by then
vi.mock('autumn-js', () => ({
	Autumn: class {
		check = check;
		track = track;
	}
}));

import { checkAndCountUsage, refundUsage } from '../autumn';

// checkAndCountUsage wraps Autumn's atomic check-with-send_event. The
// outcome mapping is the single place that decides between counted,
// denied, and fail-open behavior for every metered feature, so each
// branch is pinned here. Call sites only branch on the outcome
// (covered in messages.test.ts and createAIResponse.test.ts).
describe('checkAndCountUsage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
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

		const outcome = await checkAndCountUsage({ customerId: 'user_1', featureId: 'messages' });

		expect(outcome).toBe('denied');
	});

	it('maps a missing data payload (non-2xx response) to unavailable', async () => {
		check.mockResolvedValue({ data: null });

		const outcome = await checkAndCountUsage({ customerId: 'user_1', featureId: 'messages' });

		expect(outcome).toBe('unavailable');
	});

	it('maps a thrown network error to unavailable', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		check.mockRejectedValue(new Error('network down'));

		const outcome = await checkAndCountUsage({ customerId: 'user_1', featureId: 'messages' });

		expect(outcome).toBe('unavailable');
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
	});

	it('credits the balance with a negative track value', async () => {
		track.mockResolvedValue({ data: {} });

		await refundUsage({ customerId: 'user_1', featureId: 'ai_chat_messages' });

		expect(track).toHaveBeenCalledWith({
			customer_id: 'user_1',
			feature_id: 'ai_chat_messages',
			value: -1
		});
	});

	it('never throws: a failed refund is logged, not propagated', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		track.mockRejectedValue(new Error('network down'));

		await expect(
			refundUsage({ customerId: 'user_1', featureId: 'ai_chat_messages', value: 2 })
		).resolves.toBeUndefined();

		expect(track).toHaveBeenCalledWith(expect.objectContaining({ value: -2 }));
		error.mockRestore();
	});
});
