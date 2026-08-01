import type { AttachResult, CheckoutResult } from '@stickerdaniel/convex-autumn-svelte/sveltekit';

/** A prepaid feature quantity, in the camelCase form the attach action wants. */
export type CheckoutAttachOption = { featureId: string; quantity: number };

/**
 * What to do with an Autumn checkout answer.
 *
 * `confirm` carries the preview untouched so the dialog can render it and the
 * attach call can reuse the same quantities.
 */
export type CheckoutOutcome =
	| { kind: 'redirect'; url: string }
	| { kind: 'confirm'; preview: CheckoutResult; options: CheckoutAttachOption[] }
	| { kind: 'failed' };

/**
 * The one place that reconciles the declared URL type with the live one.
 *
 * Autumn declares `url` as `string | undefined`, but the API answers `null`
 * whenever the purchase needs an in-app confirmation instead of a hosted
 * session. Treating anything that is not a usable string as absent keeps that
 * discrepancy from leaking into the call sites, where it previously turned
 * into a button that did nothing at all.
 */
function normalizeUrl(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Whether a purchase charges prepaid quantities the customer has to confirm. */
function hasPrepaidItem(preview: CheckoutResult): boolean {
	return (preview.product?.items ?? []).some((item) => item.usage_model === 'prepaid');
}

/**
 * Decide how to complete a checkout.
 *
 * Autumn has two success shapes and the difference is not an error: a hosted
 * Stripe session to redirect to, or a preview to confirm in the app and
 * complete with `attach`. Prepaid purchases always take the confirmation path,
 * even when a URL is present, because the customer has to see the quantities
 * being charged — this mirrors Autumn's own React client, which opens its
 * dialog whenever a prepaid item is involved and a dialog is available.
 *
 * A preview missing the fields the dialog and the attach call depend on is
 * reported as `failed` rather than rendered half-empty.
 */
export function getCheckoutOutcome(result: CheckoutResult): CheckoutOutcome {
	if (!result?.product?.id || !Array.isArray(result.lines)) {
		return { kind: 'failed' };
	}

	const url = normalizeUrl(result.url);
	if (url && !hasPrepaidItem(result)) {
		return { kind: 'redirect', url };
	}

	const options = (result.options ?? []).map((option) => ({
		featureId: option.feature_id,
		quantity: option.quantity
	}));

	return { kind: 'confirm', preview: result, options };
}

/**
 * The hosted page an attach still needs, if any.
 *
 * Autumn returns `checkout_url` when the stored payment method could not be
 * charged after all. Ignoring it would leave the purchase unfinished and
 * silent, which is the failure this whole flow exists to remove.
 */
export function getAttachCheckoutUrl(result: AttachResult): string | null {
	return normalizeUrl(result?.checkout_url);
}
