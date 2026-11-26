<script lang="ts">
	import { useCustomer, useAutumnOperation } from '@stickerdaniel/convex-autumn-svelte/sveltekit';
	import { page } from '$app/state';
	import { getTranslate } from '@tolgee/svelte';
	import { toast } from 'svelte-sonner';
	import { activeUploadsContext } from '#lib/hooks/active-uploads.svelte.ts';
	import { haptic } from '#lib/hooks/use-haptic.svelte.ts';
	import { setBillingCheckoutContext } from './checkout-context.svelte.ts';
	import type CheckoutDialog from './checkout-dialog.svelte';

	let { children } = $props();

	const autumn = useCustomer();
	const checkoutOperation = useAutumnOperation(autumn.checkout);
	const attachOperation = useAutumnOperation(autumn.attach);
	const activeUploads = activeUploadsContext.getOr(null);
	const { t } = getTranslate();
	const billingUsable = $derived(
		page.data.capabilities?.billing.usable === true || page.data.localE2E?.billing === true
	);

	function reportError(stage: 'checkout' | 'confirm'): void {
		haptic.trigger('error');
		toast.error(stage === 'confirm' ? $t('billing.attach_failed') : $t('billing.checkout_failed'));
		console.error(
			stage === 'confirm' ? '[BillingCheckout.confirm] Failed' : '[BillingCheckout.start] Failed'
		);
	}

	const checkout = setBillingCheckoutContext({
		checkout: checkoutOperation,
		attach: attachOperation,
		redirect: (url) => {
			// Leaving the document would otherwise trip the upload guard and
			// strand the user on a purchase that already happened. Both the
			// hosted checkout session and the attach fallback go through here.
			activeUploads?.suspendOnce();
			window.location.href = url;
		},
		isUsable: () => billingUsable,
		onUnavailable: () => {
			haptic.trigger('error');
			toast.error($t('capabilities.billing_unavailable'));
		},
		onError: reportError
	});

	let Dialog: typeof CheckoutDialog | null = $state(null);
	let loading = false;

	async function loadDialog(): Promise<void> {
		loading = true;
		try {
			const module = await import('./checkout-dialog.svelte');
			Dialog = module.default;
		} catch {
			if (!checkout.open) return;
			checkout.cancel();
			if (!checkout.open) reportError('checkout');
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if ((checkout.isLoading || checkout.open) && !Dialog && !loading) void loadDialog();
	});
</script>

{@render children()}

{#if Dialog}
	<Dialog />
{/if}
