<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import BrandSection from '$lib/components/brand/brand-section.svelte';
	import { MOTION_PRINCIPLES, MOTION_PULLQUOTE, SHADER_COLLECTIONS } from '$lib/brand/brand-config';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

	const TIMING_TOKENS = [
		{ token: '--motion-fast', duration: '100ms', ease: 'ease-out', use: 'Hover, focus rings' },
		{
			token: '--motion-base',
			duration: '200ms',
			ease: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
			use: 'Default UI transitions'
		},
		{
			token: '--motion-slow',
			duration: '400ms',
			ease: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
			use: 'Panel enter/leave'
		},
		{
			token: '--motion-emphasis',
			duration: '800ms',
			ease: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
			use: 'Brand moments only — must justify'
		}
	] as const;
</script>

<SEOHead title={$t('meta.brand_motion.title')} description={$t('meta.brand_motion.description')} />

<header class="pb-12">
	<p class="mb-4 text-xs tracking-[0.2em] text-primary uppercase">Motion</p>
	<h1 class="brand-display text-5xl leading-[1.05] lg:text-6xl">
		{MOTION_PULLQUOTE}
	</h1>
</header>

<BrandSection id="principles" eyebrow="Principles" title="Animate rarely. Mean it when you do.">
	<ol class="space-y-6">
		{#each MOTION_PRINCIPLES as principle (principle.number)}
			<li class="flex gap-5 border-t border-border/60 pt-6 first:border-t-0 first:pt-0">
				<span class="brand-display w-10 text-3xl leading-none text-primary">
					{principle.number}
				</span>
				<div>
					<p class="mb-2 text-lg font-semibold">{principle.title}</p>
					<p class="text-base leading-relaxed text-foreground/75">{principle.body}</p>
				</div>
			</li>
		{/each}
	</ol>
</BrandSection>

<BrandSection
	id="shaders"
	eyebrow="Shader library"
	title="Five atmospheres."
	intro="Sourced from the Cadenza shader collection. Each renders live where supported, with a static gradient fallback for prefers-reduced-motion and SSR. Never behind body copy."
>
	<div class="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
		{#each SHADER_COLLECTIONS as shader, i (shader.name)}
			<article class="overflow-hidden rounded-2xl border border-border/60 bg-background">
				<div
					class="aspect-[4/3] w-full"
					style={[
						'background: linear-gradient(135deg,',
						i === 0
							? 'var(--color-brand-terracotta), var(--color-brand-amber))'
							: i === 1
								? 'var(--color-brand-ink), var(--color-brand-terracotta))'
								: i === 2
									? 'var(--color-brand-amber), var(--color-brand-cream))'
									: i === 3
										? 'var(--color-brand-ink), var(--color-brand-amber))'
										: 'var(--color-brand-terracotta), var(--color-brand-ink))'
					].join(' ')}
					aria-hidden="true"
				></div>
				<div class="p-5">
					<h3 class="mb-2 text-lg font-semibold">{shader.name}</h3>
					<p class="text-sm leading-relaxed text-muted-foreground">{shader.use}</p>
				</div>
			</article>
		{/each}
	</div>
	<p class="mt-6 text-sm text-muted-foreground">
		Live shader implementations live in the Cadenza shader collection (webdocs). The previews above
		use the static brand-gradient fallbacks.
	</p>
</BrandSection>

<BrandSection id="timing" eyebrow="Timing tokens" title="Four durations. One easing curve.">
	<div class="overflow-hidden rounded-2xl border border-border/60 bg-background">
		<table class="w-full text-left text-sm">
			<thead class="border-b border-border/60 text-xs text-muted-foreground uppercase">
				<tr>
					<th class="px-5 py-3 font-medium">Token</th>
					<th class="px-5 py-3 font-medium">Duration</th>
					<th class="hidden px-5 py-3 font-medium md:table-cell">Easing</th>
					<th class="hidden px-5 py-3 font-medium md:table-cell">Use</th>
				</tr>
			</thead>
			<tbody>
				{#each TIMING_TOKENS as token (token.token)}
					<tr class="border-b border-border/40 last:border-b-0">
						<td class="px-5 py-4"><code class="text-xs">{token.token}</code></td>
						<td class="px-5 py-4">{token.duration}</td>
						<td class="hidden px-5 py-4 md:table-cell"><code class="text-xs">{token.ease}</code></td
						>
						<td class="hidden px-5 py-4 text-muted-foreground md:table-cell">{token.use}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</BrandSection>
