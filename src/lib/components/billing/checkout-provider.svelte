<script lang="ts">
	import { useCustomer, useAutumnOperation } from '@stickerdaniel/convex-autumn-svelte/sveltekit';
	import { getTranslate } from '@tolgee/svelte';
	import { toast } from 'svelte-sonner';
	import { activeUploadsContext } from '$lib/hooks/active-uploads.svelte.ts';
	import { haptic } from '$lib/hooks/use-haptic.svelte.ts';
	import CheckoutDialog from './checkout-dialog.svelte';
	import { setBillingCheckoutContext } from './checkout-context.svelte.ts';

	let { children } = $props();

	const autumn = useCustomer();
	const checkoutOperation = useAutumnOperation(autumn.checkout);
	const attachOperation = useAutumnOperation(autumn.attach);
	const activeUploads = activeUploadsContext.getOr(null);
	const { t } = getTranslate();

	setBillingCheckoutContext({
		checkout: checkoutOperation,
		attach: attachOperation,
		redirect: (url) => {
			// Leaving the document would otherwise trip the upload guard and
			// strand the user on a purchase that already happened. Both the
			// hosted checkout session and the attach fallback go through here.
			activeUploads?.suspendOnce();
			window.location.href = url;
		},
		onError: (stage, error) => {
			haptic.trigger('error');
			toast.error(
				stage === 'confirm' ? $t('billing.attach_failed') : $t('billing.checkout_failed')
			);
			console.error(`[billing] ${stage} failed:`, error);
		}
	});
</script>

{@render children()}

<CheckoutDialog />
