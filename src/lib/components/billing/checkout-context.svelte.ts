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
	readonly error: Error | null;
	execute: (params: TParams) => Promise<TResult | null>;
};

type CheckoutSession =
	| { kind: 'idle' }
	| {
			kind: 'confirmation';
			params: CheckoutStartParams;
			preview: CheckoutResult;
			options: CheckoutAttachOption[];
	  };

type CheckoutOperation =
	| { kind: 'idle' }
	| { kind: 'starting'; generation: number }
	| { kind: 'repricing'; generation: number }
	| { kind: 'attaching'; generation: number };

type ActiveCheckoutOperation = Exclude<CheckoutOperation, { kind: 'idle' }>;
type CheckoutOperationKind = ActiveCheckoutOperation['kind'];

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
	#session = $state.raw<CheckoutSession>({ kind: 'idle' });
	#operation = $state.raw<CheckoutOperation>({ kind: 'idle' });
	// A purchase is money: two overlapping calls must not both go through, and
	// an answer that arrives after the user moved on must not be applied. Every
	// operation receives a generation before its first await. Cancellation and
	// replacement advance the same counter so stale completions cannot publish.
	#generation = 0;

	constructor(deps: BillingCheckoutDeps) {
		this.#deps = deps;
	}

	get open(): boolean {
		return this.#session.kind === 'confirmation';
	}

	get preview(): CheckoutResult | null {
		return this.#session.kind === 'confirmation' ? this.#session.preview : null;
	}

	get options(): CheckoutAttachOption[] {
		return this.#session.kind === 'confirmation' ? this.#session.options : [];
	}

	get isAttaching(): boolean {
		return this.#operation.kind === 'attaching';
	}

	/** True while an open preview is being re-priced for new quantities. */
	get isUpdating(): boolean {
		return this.#operation.kind === 'repricing';
	}

	/**
	 * True while a call is in flight, false while the open dialog waits for the
	 * user. Upgrade buttons bind to this, and a spinner behind a modal that is
	 * waiting on a decision would be a lie.
	 */
	get isLoading(): boolean {
		return this.#operation.kind !== 'idle';
	}

	async start(params: CheckoutStartParams): Promise<void> {
		const generation = this.#beginOperation('starting', true);
		if (generation === null) return;

		try {
			const result = await this.#deps.checkout.execute(params);
			if (!this.#ownsOperation('starting', generation)) return;

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

			this.#session = {
				kind: 'confirmation',
				params,
				preview: outcome.preview,
				options: outcome.options
			};
		} finally {
			this.#finishOperation('starting', generation);
		}
	}

	async confirm(): Promise<void> {
		const session = this.#session;
		if (session.kind !== 'confirmation') return;

		const generation = this.#beginOperation('attaching');
		if (generation === null) return;

		try {
			const result = await this.#deps.attach.execute({
				...session.params,
				productId: session.preview.product.id,
				options: session.options
			});
			if (!this.#ownsOperation('attaching', generation)) return;

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

			this.#session = { kind: 'idle' };
		} finally {
			this.#finishOperation('attaching', generation);
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
		const session = this.#session;
		if (session.kind !== 'confirmation') return;

		const generation = this.#beginOperation('repricing');
		if (generation === null) return;

		try {
			const result = await this.#deps.checkout.execute({ ...session.params, options });
			if (!this.#ownsOperation('repricing', generation)) return;

			if (!result) {
				this.#deps.onError('checkout', this.#deps.checkout.error);
				return;
			}

			const outcome = getCheckoutOutcome(result);
			if (outcome.kind !== 'confirm') return;

			this.#session = {
				...session,
				preview: outcome.preview,
				options: outcome.options
			};
		} finally {
			this.#finishOperation('repricing', generation);
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
		if (open) return;
		if (this.isAttaching) return;
		this.#invalidate();
	}

	#beginOperation(kind: CheckoutOperationKind, clearSession = false): number | null {
		if (this.#operation.kind !== 'idle') return null;

		const generation = ++this.#generation;
		if (clearSession) this.#session = { kind: 'idle' };
		this.#operation = { kind, generation };
		return generation;
	}

	#ownsOperation(kind: CheckoutOperationKind, generation: number): boolean {
		return (
			this.#generation === generation &&
			this.#operation.kind === kind &&
			this.#operation.generation === generation
		);
	}

	#finishOperation(kind: CheckoutOperationKind, generation: number): void {
		if (this.#operation.kind !== kind || this.#operation.generation !== generation) return;
		this.#operation = { kind: 'idle' };
	}

	#invalidate(): void {
		// The underlying request may still settle, so it remains the active
		// operation and keeps the single-flight guard. Advancing the generation
		// prevents it from publishing after the user leaves the session; its own
		// finally block releases only that exact operation.
		this.#generation += 1;
		this.#session = { kind: 'idle' };
	}
}

const billingCheckoutContext = new Context<BillingCheckoutManager>('billing-checkout');

export function setBillingCheckoutContext(deps: BillingCheckoutDeps): BillingCheckoutManager {
	return billingCheckoutContext.set(new BillingCheckoutManager(deps));
}

export function useBillingCheckout(): BillingCheckoutManager {
	return billingCheckoutContext.get();
}
