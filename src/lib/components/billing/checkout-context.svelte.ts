import { Context } from 'runed';
import type { AttachResult, CheckoutResult } from '@stickerdaniel/convex-autumn-svelte/sveltekit';
import {
	getAttachCheckoutUrl,
	getCheckoutOutcome,
	type CheckoutAttachOption
} from '$lib/billing/checkout-result';

/** Everything a call site knows about the purchase it wants to start. */
export type CheckoutStartParams = {
	productId: string;
	successUrl?: string;
	[key: string]: unknown;
};

/**
 * The two Autumn calls, as `useAutumnOperation` exposes them.
 *
 * Typed structurally rather than against the wrapper so the manager can be
 * driven by fakes in tests: `execute` resolves to `null` when the underlying
 * action throws, and the matching `error` holds the reason.
 */
type Operation<TParams, TResult> = {
	readonly isLoading: boolean;
	readonly error: Error | null;
	execute: (params: TParams) => Promise<TResult | null>;
};

export type BillingCheckoutDeps = {
	checkout: Operation<CheckoutStartParams, CheckoutResult>;
	attach: Operation<CheckoutStartParams, AttachResult>;
	/** Leaves the document. Suspends the upload guard first. */
	redirect: (url: string) => void;
	onError: (stage: 'checkout' | 'confirm', error: Error | null) => void;
};

/**
 * Drives Autumn's two-step purchase across every upgrade button in the app.
 *
 * Autumn answers a checkout either with a hosted Stripe session or with a
 * preview that has to be confirmed in the app and completed with `attach`.
 * Both endings live here so no call site can handle one and forget the other,
 * which is exactly how the upgrade button used to fail: silently.
 */
export class BillingCheckoutManager {
	#deps: BillingCheckoutDeps;
	#open = $state(false);
	#preview = $state.raw<CheckoutResult | null>(null);
	#options = $state.raw<CheckoutAttachOption[]>([]);
	#updating = $state(false);
	// A purchase is money: two overlapping calls must not both go through, and
	// an answer that arrives after the user moved on must not be applied.
	// `useAutumnOperation` only toggles a boolean around its call, so the
	// serialisation lives here. #inFlight is set before the first await;
	// #generation invalidates anything a cancel or a newer start superseded.
	#inFlight = false;
	#generation = 0;
	// The parameters the purchase started with. Confirming reuses them so
	// successUrl and any caller-specific extras survive into the attach call.
	#params: CheckoutStartParams | null = null;

	constructor(deps: BillingCheckoutDeps) {
		this.#deps = deps;
	}

	get open(): boolean {
		return this.#open;
	}

	get preview(): CheckoutResult | null {
		return this.#preview;
	}

	get options(): CheckoutAttachOption[] {
		return this.#options;
	}

	get isAttaching(): boolean {
		return this.#deps.attach.isLoading;
	}

	/** True while an open preview is being re-priced for new quantities. */
	get isUpdating(): boolean {
		return this.#updating;
	}

	/**
	 * True while a call is in flight, false while the open dialog waits for the
	 * user. Upgrade buttons bind to this, and a spinner behind a modal that is
	 * waiting on a decision would be a lie.
	 */
	get isLoading(): boolean {
		return this.#deps.checkout.isLoading || this.#deps.attach.isLoading;
	}

	async start(params: CheckoutStartParams): Promise<void> {
		if (this.#inFlight) return;

		this.#clear();
		const generation = this.#generation;
		this.#inFlight = true;

		try {
			const result = await this.#deps.checkout.execute(params);
			if (generation !== this.#generation) return;

			if (!result) {
				this.#deps.onError('checkout', this.#deps.checkout.error);
				return;
			}

			const outcome = getCheckoutOutcome(result);
			if (outcome.kind === 'failed') {
				this.#deps.onError('checkout', new Error('Checkout returned an unusable preview'));
				return;
			}

			if (outcome.kind === 'redirect') {
				this.#deps.redirect(outcome.url);
				return;
			}

			this.#params = params;
			this.#preview = outcome.preview;
			this.#options = outcome.options;
			this.#open = true;
		} finally {
			this.#inFlight = false;
		}
	}

	async confirm(): Promise<void> {
		const preview = this.#preview;
		const params = this.#params;
		if (!preview || !params || this.#inFlight) return;

		const generation = this.#generation;
		this.#inFlight = true;

		try {
			const result = await this.#deps.attach.execute({
				...params,
				productId: preview.product.id,
				options: this.#options
			});
			if (generation !== this.#generation) return;

			if (!result) {
				// Keep the dialog and its preview so the purchase can be retried.
				this.#deps.onError('confirm', this.#deps.attach.error);
				return;
			}

			const checkoutUrl = getAttachCheckoutUrl(result);
			if (checkoutUrl) {
				this.#deps.redirect(checkoutUrl);
				return;
			}

			this.#clear();
		} finally {
			this.#inFlight = false;
		}
	}

	/**
	 * Re-price the open preview for different prepaid quantities.
	 *
	 * Nothing in this template renders quantity inputs, because none of its
	 * plans sell prepaid items. Forks that do can wire an editor to this
	 * without touching the shared flow.
	 */
	async updateOptions(options: CheckoutAttachOption[]): Promise<void> {
		const params = this.#params;
		if (!params || this.#inFlight) return;

		const generation = this.#generation;
		this.#inFlight = true;
		this.#updating = true;

		try {
			const result = await this.#deps.checkout.execute({ ...params, options });
			if (generation !== this.#generation) return;

			if (!result) {
				this.#deps.onError('checkout', this.#deps.checkout.error);
				return;
			}

			const outcome = getCheckoutOutcome(result);
			if (outcome.kind !== 'confirm') return;

			this.#preview = outcome.preview;
			this.#options = outcome.options;
		} finally {
			this.#inFlight = false;
			this.#updating = false;
		}
	}

	cancel(): void {
		this.setOpen(false);
	}

	/**
	 * Closing is refused while the purchase is being charged.
	 *
	 * Escape and the cancel button both land here, and the dialog is bound
	 * through a function so the child cannot close itself past this guard.
	 */
	setOpen(open: boolean): void {
		if (open) {
			this.#open = true;
			return;
		}
		if (this.isAttaching) return;
		this.#clear();
	}

	#clear(): void {
		// Anything still in flight belongs to a purchase the user left behind.
		this.#generation += 1;
		this.#open = false;
		this.#preview = null;
		this.#options = [];
		this.#params = null;
	}
}

const billingCheckoutContext = new Context<BillingCheckoutManager>('billing-checkout');

export function setBillingCheckoutContext(deps: BillingCheckoutDeps): BillingCheckoutManager {
	return billingCheckoutContext.set(new BillingCheckoutManager(deps));
}

export function useBillingCheckout(): BillingCheckoutManager {
	return billingCheckoutContext.get();
}
