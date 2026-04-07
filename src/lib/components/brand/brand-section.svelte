<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		id: string;
		eyebrow?: string;
		title?: string;
		intro?: string;
		children?: Snippet;
	}

	let { id, eyebrow, title, intro, children }: Props = $props();
</script>

<section {id} class="scroll-mt-28 border-t border-border/60 py-16 first:border-t-0 lg:py-24">
	<div class="mx-auto max-w-3xl">
		{#if eyebrow}
			<p class="mb-4 text-xs tracking-[0.2em] text-primary uppercase">{eyebrow}</p>
		{/if}
		{#if title}
			<h2 class="brand-display mb-6 text-4xl leading-tight lg:text-5xl">
				{title}
			</h2>
		{/if}
		{#if intro}
			<p class="mb-10 text-lg leading-relaxed text-foreground/80 lg:text-xl">{intro}</p>
		{/if}
		{@render children?.()}
	</div>
</section>
