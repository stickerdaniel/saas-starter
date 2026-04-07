<script lang="ts">
	import type { BrandFont } from '$lib/brand/typography';

	interface Props {
		font: BrandFont;
		sample?: string;
	}

	let { font, sample = 'reads the room before it writes' }: Props = $props();

	const fontFamily = $derived(
		font.name === 'Fraunces' ? 'var(--font-brand-serif)' : 'var(--font-brand-sans)'
	);
	const fontStyle = $derived(font.italic ? 'italic' : 'normal');
</script>

<article
	class="overflow-hidden rounded-2xl border border-border/60 bg-background p-8 lg:p-10"
	data-testid="brand-typography-specimen"
>
	<header class="mb-6 flex items-baseline justify-between gap-4">
		<div>
			<p class="mb-1 text-xs tracking-[0.2em] text-primary uppercase">the {font.role}</p>
			<h3 class="text-2xl font-semibold">{font.name}</h3>
		</div>
		<p class="text-sm text-muted-foreground">
			{font.weights.join(' · ')}{font.italic ? ' · italic' : ''}
		</p>
	</header>

	<p class="mb-6 text-sm leading-relaxed text-foreground/80">{font.description}</p>

	<p
		class="mb-4 leading-[1.05] text-balance"
		style="font-family: {fontFamily}; font-style: {fontStyle}; font-size: clamp(2.5rem, 6vw, 4.5rem);"
	>
		{sample}
	</p>

	<div class="grid grid-cols-1 gap-4 text-sm text-muted-foreground sm:grid-cols-2">
		<div>
			<p class="mb-1 text-xs tracking-wider text-foreground uppercase">Use</p>
			<ul class="space-y-1">
				{#each font.usage as item (item)}
					<li>— {item}</li>
				{/each}
			</ul>
		</div>
		<div>
			<p class="mb-1 text-xs tracking-wider text-foreground uppercase">Avoid</p>
			<ul class="space-y-1">
				{#each font.avoid as item (item)}
					<li>— {item}</li>
				{/each}
			</ul>
		</div>
	</div>
</article>
