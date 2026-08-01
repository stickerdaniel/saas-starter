import { describe, expect, it } from 'vitest';
import type { CheckoutResult } from '@stickerdaniel/convex-autumn-svelte/sveltekit';
import { getAttachCheckoutUrl, getCheckoutOutcome } from './checkout-result';

function product(id: string, usageModel?: 'prepaid' | 'pay_per_use') {
	return {
		id,
		name: id === 'pro' ? 'Pro' : 'Free',
		created_at: 1_735_689_600_000,
		env: 'sandbox',
		is_add_on: false,
		is_default: id === 'free',
		group: 'main',
		version: 1,
		items: usageModel ? [{ feature_id: 'seats', usage_model: usageModel }] : [],
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

describe('getCheckoutOutcome', () => {
	it('redirects when Autumn hands back a hosted session', () => {
		expect(
			getCheckoutOutcome(preview({ url: 'https://checkout.stripe.com/c/pay/cs_test' }))
		).toEqual({ kind: 'redirect', url: 'https://checkout.stripe.com/c/pay/cs_test' });
	});

	// The live API answers null here while the installed types promise
	// string | undefined. Both spellings, and an empty string, mean the same
	// thing: there is nothing to redirect to, so confirm the preview instead.
	it.each([
		['null', null],
		['undefined', undefined],
		['an empty string', '']
	])('asks for confirmation when the url is %s', (_label, url) => {
		const result = preview({ url: url as CheckoutResult['url'] });
		expect(getCheckoutOutcome(result)).toEqual({
			kind: 'confirm',
			preview: result,
			options: []
		});
	});

	// Autumn's own client shows its dialog whenever prepaid items are involved:
	// the customer has to see the quantities before they are charged.
	it('asks for confirmation for prepaid purchases even with a url', () => {
		const result = preview({
			url: 'https://checkout.stripe.com/c/pay/cs_test',
			product: product('pro', 'prepaid') as CheckoutResult['product'],
			options: [{ feature_id: 'seats', quantity: 5 }]
		});

		expect(getCheckoutOutcome(result)).toMatchObject({ kind: 'confirm' });
	});

	it('carries prepaid quantities over in the shape attach expects', () => {
		const result = preview({
			options: [
				{ feature_id: 'seats', quantity: 5 },
				{ feature_id: 'credits', quantity: 100 }
			]
		});

		expect(getCheckoutOutcome(result)).toMatchObject({
			options: [
				{ featureId: 'seats', quantity: 5 },
				{ featureId: 'credits', quantity: 100 }
			]
		});
	});

	// A half-formed answer used to fall through every branch and leave the
	// button idle with no explanation. It has to be a visible failure now.
	it.each([
		['no product', { product: undefined }],
		['no lines', { lines: undefined }]
	])('reports failure for a preview with %s', (_label, overrides) => {
		expect(getCheckoutOutcome(preview(overrides as Partial<CheckoutResult>))).toEqual({
			kind: 'failed'
		});
	});
});

describe('getAttachCheckoutUrl', () => {
	it('surfaces the hosted page when the stored card could not be charged', () => {
		expect(getAttachCheckoutUrl({ checkout_url: 'https://checkout.test/x' } as never)).toBe(
			'https://checkout.test/x'
		);
	});

	it.each([
		['null', null],
		['undefined', undefined],
		['an empty string', '']
	])('returns null when checkout_url is %s', (_label, value) => {
		expect(getAttachCheckoutUrl({ checkout_url: value } as never)).toBeNull();
	});
});
