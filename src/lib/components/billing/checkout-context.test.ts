import { describe, expect, it, vi } from 'vitest';
import type { AttachResult, CheckoutResult } from '@stickerdaniel/convex-autumn-svelte/sveltekit';
import { BillingCheckoutManager, type BillingCheckoutDeps } from './checkout-context.svelte.ts';

function product(id: string) {
	return {
		id,
		name: id === 'pro' ? 'Pro' : 'Free',
		created_at: 1_735_689_600_000,
		env: 'sandbox',
		is_add_on: false,
		is_default: id === 'free',
		group: 'main',
		version: 1,
		items: [],
		free_trial: null,
		base_variant_id: null,
		properties: {
			is_free: id === 'free',
			is_one_off: false,
			interval_group: 'month',
			has_trial: false,
			updateable: true
		}
	};
}

function preview(overrides: Partial<CheckoutResult> = {}): CheckoutResult {
	return {
		url: null,
		customer_id: 'customer_1',
		has_prorations: false,
		lines: [{ description: 'Pro - $10 / month', amount: 10, item: {} }],
		total: 10,
		currency: 'usd',
		options: [],
		product: product('pro'),
		current_product: product('free'),
		...overrides
	} as CheckoutResult;
}

/** A stand-in for `useAutumnOperation`: resolves to null when it "throws". */
function operation<T>(result: T | null, error: Error | null = null) {
	const state = {
		isLoading: false,
		error,
		execute: vi.fn(async () => {
			state.isLoading = true;
			try {
				return result;
			} finally {
				state.isLoading = false;
			}
		})
	};
	return state;
}

/** An operation whose call can be released by the test, one await at a time. */
function deferredOperation<T>(result: T | null, error: Error | null = null) {
	const releases: Array<() => void> = [];
	const state = {
		isLoading: false,
		error,
		calls: 0,
		execute: vi.fn(async () => {
			state.calls += 1;
			state.isLoading = true;
			await new Promise<void>((resolve) => releases.push(resolve));
			state.isLoading = false;
			return result;
		}),
		releaseAll: () => releases.splice(0).forEach((release) => release())
	};
	return state;
}

function setup(overrides: Partial<BillingCheckoutDeps> = {}) {
	const deps = {
		checkout: operation<CheckoutResult>(preview()),
		attach: operation<AttachResult>({
			customer_id: 'customer_1',
			product_ids: ['pro'],
			code: 'attached',
			message: 'ok'
		} as AttachResult),
		redirect: vi.fn(),
		onError: vi.fn(),
		...overrides
	} as unknown as BillingCheckoutDeps & {
		checkout: ReturnType<typeof operation<CheckoutResult>>;
		attach: ReturnType<typeof operation<AttachResult>>;
		redirect: ReturnType<typeof vi.fn>;
		onError: ReturnType<typeof vi.fn>;
	};

	return { deps, manager: new BillingCheckoutManager(deps) };
}

describe('BillingCheckoutManager.start', () => {
	it('reports a thrown checkout instead of leaving the button silent', async () => {
		const boom = new Error('network');
		const { deps, manager } = setup({ checkout: operation<CheckoutResult>(null, boom) as never });

		await manager.start({ productId: 'pro' });

		expect(deps.onError).toHaveBeenCalledWith('checkout', boom);
		expect(manager.open).toBe(false);
		expect(deps.redirect).not.toHaveBeenCalled();
	});

	it('reports an unusable preview rather than opening an empty dialog', async () => {
		const { deps, manager } = setup({
			checkout: operation<CheckoutResult>(preview({ product: undefined })) as never
		});

		await manager.start({ productId: 'pro' });

		expect(deps.onError).toHaveBeenCalledWith('checkout', expect.any(Error));
		expect(manager.open).toBe(false);
	});

	it('redirects to a hosted session without opening the dialog', async () => {
		const url = 'https://checkout.stripe.com/c/pay/cs_test';
		const { deps, manager } = setup({
			checkout: operation<CheckoutResult>(preview({ url })) as never
		});

		await manager.start({ productId: 'pro' });

		expect(deps.redirect).toHaveBeenCalledWith(url);
		expect(manager.open).toBe(false);
	});

	it('opens the dialog with the preview when there is no hosted session', async () => {
		const { manager } = setup({
			checkout: operation<CheckoutResult>(
				preview({ options: [{ feature_id: 'seats', quantity: 3 }] })
			) as never
		});

		await manager.start({ productId: 'pro' });

		expect(manager.open).toBe(true);
		expect(manager.preview?.product.id).toBe('pro');
		expect(manager.options).toEqual([{ featureId: 'seats', quantity: 3 }]);
		// Nothing is in flight while the dialog waits for a decision, so the
		// buttons behind it must not sit there spinning.
		expect(manager.isLoading).toBe(false);
	});
});

describe('BillingCheckoutManager.confirm', () => {
	it('attaches the previewed product with the original parameters', async () => {
		const { deps, manager } = setup({
			checkout: operation<CheckoutResult>(
				preview({ options: [{ feature_id: 'seats', quantity: 3 }] })
			) as never
		});

		await manager.start({ productId: 'pro', successUrl: 'https://app.test/done' });
		await manager.confirm();

		expect(deps.attach.execute).toHaveBeenCalledWith({
			productId: 'pro',
			successUrl: 'https://app.test/done',
			options: [{ featureId: 'seats', quantity: 3 }]
		});
		expect(manager.open).toBe(false);
	});

	it('follows the hosted page when the stored card could not be charged', async () => {
		const { deps, manager } = setup({
			attach: operation<AttachResult>({
				customer_id: 'customer_1',
				product_ids: ['pro'],
				code: 'checkout_created',
				message: 'Payment required',
				checkout_url: 'https://checkout.test/attach'
			} as AttachResult) as never
		});

		await manager.start({ productId: 'pro' });
		await manager.confirm();

		expect(deps.redirect).toHaveBeenCalledWith('https://checkout.test/attach');
	});

	it('keeps the dialog open so a failed purchase can be retried', async () => {
		const boom = new Error('declined');
		const { deps, manager } = setup({ attach: operation<AttachResult>(null, boom) as never });

		await manager.start({ productId: 'pro' });
		await manager.confirm();

		expect(deps.onError).toHaveBeenCalledWith('confirm', boom);
		expect(manager.open).toBe(true);
		expect(manager.preview).not.toBeNull();
	});
});

describe('BillingCheckoutManager closing', () => {
	it('refuses to close while the purchase is being charged', async () => {
		const { deps, manager } = setup();
		await manager.start({ productId: 'pro' });

		deps.attach.isLoading = true;
		manager.setOpen(false);

		expect(manager.open).toBe(true);
	});

	it('closes and forgets the preview once nothing is in flight', async () => {
		const { manager } = setup();
		await manager.start({ productId: 'pro' });

		manager.cancel();

		expect(manager.open).toBe(false);
		expect(manager.preview).toBeNull();
	});
});

describe('BillingCheckoutManager.updateOptions', () => {
	it('re-prices the open preview for new quantities', async () => {
		const first = preview({ options: [{ feature_id: 'seats', quantity: 3 }] });
		const second = preview({ total: 20, options: [{ feature_id: 'seats', quantity: 6 }] });
		const checkout = operation<CheckoutResult>(first);
		const { deps, manager } = setup({ checkout: checkout as never });

		await manager.start({ productId: 'pro' });
		checkout.execute.mockResolvedValueOnce(second);
		await manager.updateOptions([{ featureId: 'seats', quantity: 6 }]);

		expect(deps.checkout.execute).toHaveBeenLastCalledWith({
			productId: 'pro',
			options: [{ featureId: 'seats', quantity: 6 }]
		});
		expect(manager.preview?.total).toBe(20);
		expect(manager.options).toEqual([{ featureId: 'seats', quantity: 6 }]);
		expect(manager.open).toBe(true);
	});
});

describe('BillingCheckoutManager concurrency', () => {
	// A purchase is money. Two clicks that slip through before the button
	// disables must not turn into two charges.
	it('charges once when confirm is invoked twice', async () => {
		const attach = deferredOperation<AttachResult>({
			customer_id: 'customer_1',
			product_ids: ['pro'],
			code: 'attached',
			message: 'ok'
		} as AttachResult);
		const { manager } = setup({ attach: attach as never });

		await manager.start({ productId: 'pro' });
		const first = manager.confirm();
		const second = manager.confirm();
		attach.releaseAll();
		await Promise.all([first, second]);

		expect(attach.calls).toBe(1);
	});

	it('ignores a second start while the first is still running', async () => {
		const checkout = deferredOperation<CheckoutResult>(preview());
		const { manager } = setup({ checkout: checkout as never });

		const first = manager.start({ productId: 'pro' });
		const second = manager.start({ productId: 'pro' });
		checkout.releaseAll();
		await Promise.all([first, second]);

		expect(checkout.calls).toBe(1);
	});

	// Closing the dialog abandons the purchase; an answer that lands afterwards
	// must not resurrect it.
	it('discards a checkout answer the user already walked away from', async () => {
		const checkout = deferredOperation<CheckoutResult>(preview());
		const { manager } = setup({ checkout: checkout as never });

		const pending = manager.start({ productId: 'pro' });
		manager.cancel();
		checkout.releaseAll();
		await pending;

		expect(manager.open).toBe(false);
		expect(manager.preview).toBeNull();
	});

	it('refuses to confirm stale quantities while a re-price is in flight', async () => {
		const checkout = deferredOperation<CheckoutResult>(preview());
		const { deps, manager } = setup({ checkout: checkout as never });

		const started = manager.start({ productId: 'pro' });
		checkout.releaseAll();
		await started;

		const updating = manager.updateOptions([{ featureId: 'seats', quantity: 6 }]);
		expect(manager.isUpdating).toBe(true);
		await manager.confirm();
		expect(deps.attach.execute).not.toHaveBeenCalled();

		checkout.releaseAll();
		await updating;
		expect(manager.isUpdating).toBe(false);
	});
});
