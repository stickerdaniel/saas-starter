<script lang="ts" generics="Props extends Record<string, unknown>">
	import type { Component } from 'svelte';
	import { languageContext } from '$lib/i18n/context';
	import CheckoutProvider from '../checkout-provider.svelte';

	// mount() cannot pass a component as the provider's children snippet.
	let { content: Content, contentProps }: { content: Component<Props>; contentProps: Props } =
		$props();

	// The root layout supplies this; the provider's confirmation dialog reads it.
	languageContext.set(() => 'en');
</script>

<CheckoutProvider>
	<Content {...contentProps} />
</CheckoutProvider>
