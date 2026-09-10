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
	const releases: Array<(result: T | null) => void> = [];
	const state = {
		isLoading: false,
		error,
		result,
		calls: 0,
		pending: 0,
		execute: vi.fn<() => Promise<T | null>>(),
		releaseNext: (_nextResult?: T | null) => {},
		releaseAll: () => {}
	};

	state.execute.mockImplementation(async () => {
		state.calls += 1;
		state.pending += 1;
		state.isLoading = true;
		try {
			return await new Promise<T | null>((resolve) => releases.push(resolve));
		} finally {
			state.pending -= 1;
			state.isLoading = state.pending > 0;
		}
	});
	state.releaseNext = (nextResult: T | null = state.result) => {
		const release = releases.shift();
		if (!release) throw new Error('No pending operation to release');
		release(nextResult);
	};
	state.releaseAll = () => releases.splice(0).forEach((release) => release(state.result));

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
		isUsable: () => true,
		onUnavailable: vi.fn(),
		onError: vi.fn(),
		...overrides
	} as unknown as BillingCheckoutDeps & {
		checkout: ReturnType<typeof operation<CheckoutResult>>;
		attach: ReturnType<typeof operation<AttachResult>>;
		redirect: ReturnType<typeof vi.fn>;
		onUnavailable: ReturnType<typeof vi.fn>;
		onError: ReturnType<typeof vi.fn>;
	};

	return { deps, manager: new BillingCheckoutManager(deps) };
}

describe('BillingCheckoutManager.start', () => {
	it('performs no provider operation when billing is unavailable', async () => {
		const { deps, manager } = setup({ isUsable: () => false });

		await manager.start({ productId: 'pro' });

		expect(deps.onUnavailable).toHaveBeenCalledOnce();
		expect(deps.checkout.execute).not.toHaveBeenCalled();
		expect(deps.attach.execute).not.toHaveBeenCalled();
	});

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
		const attach = operation<AttachResult>(null, boom);
		const { deps, manager } = setup({ attach: attach as never });

		await manager.start({ productId: 'pro' });
		await manager.confirm();

		expect(deps.onError).toHaveBeenCalledWith('confirm', boom);
		expect(manager.open).toBe(true);
		expect(manager.preview).not.toBeNull();
		expect(manager.isAttaching).toBe(false);

		attach.error = null;
		attach.execute.mockResolvedValueOnce({
			customer_id: 'customer_1',
			product_ids: ['pro'],
			code: 'attached',
			message: 'ok'
		} as AttachResult);
		await manager.confirm();

		expect(attach.execute).toHaveBeenCalledTimes(2);
		expect(manager.open).toBe(false);
	});
});

describe('BillingCheckoutManager closing', () => {
	it('refuses to close while the purchase is being charged', async () => {
		const attach = deferredOperation<AttachResult>({
			customer_id: 'customer_1',
			product_ids: ['pro'],
			code: 'attached',
			message: 'ok'
		} as AttachResult);
		const { manager } = setup({ attach: attach as never });
		await manager.start({ productId: 'pro' });

		const confirming = manager.confirm();
		expect(manager.isAttaching).toBe(true);
		expect(manager.isLoading).toBe(true);
		manager.setOpen(false);

		expect(manager.open).toBe(true);

		attach.releaseAll();
		await confirming;
		expect(manager.isAttaching).toBe(false);
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

	it('keeps the last usable preview when re-pricing fails', async () => {
		const first = preview({ total: 10, options: [{ feature_id: 'seats', quantity: 3 }] });
		const boom = new Error('pricing unavailable');
		const checkout = operation<CheckoutResult>(first);
		const { deps, manager } = setup({ checkout: checkout as never });

		await manager.start({ productId: 'pro' });
		checkout.error = boom;
		checkout.execute.mockResolvedValueOnce(null);
		await manager.updateOptions([{ featureId: 'seats', quantity: 6 }]);

		expect(deps.onError).toHaveBeenCalledWith('checkout', boom);
		expect(manager.open).toBe(true);
		expect(manager.preview?.total).toBe(10);
		expect(manager.options).toEqual([{ featureId: 'seats', quantity: 3 }]);
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

	it('keeps a cancelled start single-flight and ignores its stale redirect', async () => {
		const staleUrl = 'https://checkout.test/stale';
		const freshPreview = preview({ total: 30 });
		const checkout = deferredOperation<CheckoutResult>(preview({ url: staleUrl }));
		const { deps, manager } = setup({ checkout: checkout as never });

		const staleStart = manager.start({ productId: 'stale' });
		expect(manager.isLoading).toBe(true);
		manager.cancel();
		expect(manager.isLoading).toBe(true);

		await manager.start({ productId: 'fresh' });
		expect(checkout.calls).toBe(1);

		checkout.releaseNext(preview({ url: staleUrl }));
		await staleStart;

		expect(deps.redirect).not.toHaveBeenCalled();
		expect(manager.isLoading).toBe(false);
		expect(manager.open).toBe(false);

		const freshStart = manager.start({ productId: 'fresh' });
		expect(checkout.calls).toBe(2);
		expect(manager.isLoading).toBe(true);
		checkout.releaseNext(freshPreview);
		await freshStart;

		expect(manager.isLoading).toBe(false);
		expect(manager.open).toBe(true);
		expect(manager.preview?.total).toBe(30);
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
		expect(manager.isLoading).toBe(true);
		expect(manager.open).toBe(true);
		expect(manager.preview?.total).toBe(10);
		await manager.confirm();
		expect(deps.attach.execute).not.toHaveBeenCalled();

		checkout.releaseAll();
		await updating;
		expect(manager.isUpdating).toBe(false);
	});

	it('discards a re-price answer after the session is cancelled', async () => {
		const first = preview({ total: 10, options: [{ feature_id: 'seats', quantity: 3 }] });
		const stale = preview({ total: 20, options: [{ feature_id: 'seats', quantity: 6 }] });
		const checkout = deferredOperation<CheckoutResult>(first);
		const { manager } = setup({ checkout: checkout as never });

		const started = manager.start({ productId: 'pro' });
		checkout.releaseAll();
		await started;

		checkout.result = stale;
		const updating = manager.updateOptions([{ featureId: 'seats', quantity: 6 }]);
		expect(manager.isUpdating).toBe(true);

		manager.cancel();
		checkout.releaseAll();
		await updating;

		expect(manager.open).toBe(false);
		expect(manager.preview).toBeNull();
		expect(manager.options).toEqual([]);
		expect(manager.isUpdating).toBe(false);
	});

	it('keeps cancelled re-pricing single-flight until its stale result settles', async () => {
		const first = preview({ total: 10, options: [{ feature_id: 'seats', quantity: 3 }] });
		const stale = preview({ total: 20, options: [{ feature_id: 'seats', quantity: 6 }] });
		const fresh = preview({ total: 40 });
		const checkout = deferredOperation<CheckoutResult>(first);
		const { manager } = setup({ checkout: checkout as never });

		const started = manager.start({ productId: 'pro' });
		checkout.releaseNext(first);
		await started;

		const updating = manager.updateOptions([{ featureId: 'seats', quantity: 6 }]);
		expect(manager.isUpdating).toBe(true);
		manager.cancel();
		expect(manager.isUpdating).toBe(true);
		expect(manager.open).toBe(false);

		await manager.start({ productId: 'team' });
		expect(checkout.calls).toBe(2);
		expect(manager.isLoading).toBe(true);

		checkout.releaseNext(stale);
		await updating;

		expect(manager.isLoading).toBe(false);
		expect(manager.open).toBe(false);

		const replacement = manager.start({ productId: 'team' });
		expect(checkout.calls).toBe(3);
		expect(manager.isLoading).toBe(true);
		checkout.releaseNext(fresh);
		await replacement;

		expect(manager.isLoading).toBe(false);
		expect(manager.open).toBe(true);
		expect(manager.preview?.total).toBe(40);
	});
});
