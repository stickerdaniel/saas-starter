<script lang="ts">
	import BrandNav from '$lib/components/brand/brand-nav.svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
	}

	let { children }: Props = $props();
</script>

<div class="brand-page min-h-svh pt-28 pb-24 lg:pt-32">
	<div class="mx-auto max-w-6xl px-6 lg:px-12">
		<div class="lg:grid lg:grid-cols-[220px_1fr] lg:gap-12">
			<aside class="lg:sticky lg:top-28 lg:self-start">
				<BrandNav />
			</aside>
			<div class="mt-8 lg:mt-0">
				{@render children?.()}
			</div>
		</div>
	</div>
</div>
