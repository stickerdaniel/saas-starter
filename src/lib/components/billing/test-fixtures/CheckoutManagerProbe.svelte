<script lang="ts">
	import { untrack } from 'svelte';
	import { useBillingCheckout, type BillingCheckoutManager } from '../checkout-context.svelte.ts';

	const props: { expose: (checkout: BillingCheckoutManager) => void } = $props();

	untrack(() => props.expose(useBillingCheckout()));
</script>
