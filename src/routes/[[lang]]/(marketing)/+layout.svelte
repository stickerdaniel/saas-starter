<script lang="ts">
	import MarketingHeader from '$lib/components/marketing/marketing-header.svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
	}

	let { children }: Props = $props();
</script>

<MarketingHeader />
<div class="pt-16 sm:pt-20">
	{@render children?.()}
</div>
