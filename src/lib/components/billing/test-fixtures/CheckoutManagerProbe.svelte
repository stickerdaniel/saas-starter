<script lang="ts">
	import { useBillingCheckout, type BillingCheckoutManager } from '../checkout-context.svelte.ts';

	const props: { expose: (checkout: BillingCheckoutManager) => void } = $props();

	props.expose(useBillingCheckout());
</script>
