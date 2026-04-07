<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import BrandSection from '$lib/components/brand/brand-section.svelte';
	import {
		TAGLINE,
		NAME_STORY,
		OBSERVATION,
		LENSES,
		OGILVY_RULES,
		PERSONALITY_TRAITS,
		POSITIONING,
		VALUES,
		ANTI_BRAND
	} from '$lib/brand/brand-config';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();
</script>

<SEOHead title={$t('meta.brand.title')} description={$t('meta.brand.description')} />

<header class="pb-12 lg:pb-20">
	<p class="mb-6 text-xs tracking-[0.2em] text-primary uppercase">Cadenza — brand</p>
	<h1 class="brand-display mb-6 text-5xl leading-[1.05] text-balance lg:text-7xl">
		{TAGLINE}
	</h1>
</header>

<BrandSection id="the-name" eyebrow="The name" title="A moment, not a broadcast.">
	{#each NAME_STORY as paragraph (paragraph)}
		<p class="mb-4 text-lg leading-relaxed text-foreground/80">{paragraph}</p>
	{/each}
</BrandSection>

<BrandSection id="the-observation" eyebrow="The observation" title={OBSERVATION.headline}>
	{#each OBSERVATION.body as paragraph (paragraph)}
		<p class="mb-4 text-lg leading-relaxed text-foreground/80">{paragraph}</p>
	{/each}
</BrandSection>

<BrandSection
	id="foundation"
	eyebrow="Theoretical foundation"
	title="Four lenses."
	intro="The brand sits at the intersection of four ideas. We name them because you deserve to know we thought about this."
>
	<div class="grid grid-cols-1 gap-5 md:grid-cols-2">
		{#each LENSES as lens (lens.number)}
			<article class="rounded-2xl border border-border/60 bg-background p-6 lg:p-8">
				<p class="mb-3 text-xs tracking-widest text-primary uppercase">
					Lens {lens.number} — {lens.thinker}
				</p>
				<h3 class="brand-display mb-4 text-2xl leading-tight lg:text-3xl">
					{lens.takeaway}
				</h3>
				{#each lens.body as paragraph (paragraph)}
					<p class="mb-3 text-sm leading-relaxed text-foreground/75 last:mb-0">
						{paragraph}
					</p>
				{/each}
			</article>
		{/each}
	</div>
</BrandSection>

<BrandSection
	id="ogilvy"
	eyebrow="The Ogilvy layer"
	title="How we actually write it down."
	intro="The four lenses give us what we believe. David Ogilvy gives us how we write it down. From Ogilvy on Advertising, the rules we adopt verbatim."
>
	<ol class="space-y-5">
		{#each OGILVY_RULES as rule, i (rule.title)}
			<li class="flex gap-4">
				<span class="brand-display text-2xl leading-none text-primary">{i + 1}</span>
				<div>
					<p class="mb-1 text-base font-semibold">{rule.title}</p>
					<p class="text-sm leading-relaxed text-muted-foreground">{rule.body}</p>
				</div>
			</li>
		{/each}
	</ol>
</BrandSection>

<BrandSection
	id="personality"
	eyebrow="Brand personality"
	title="Five traits, ranked."
	intro="In order. The earlier ones outrank the later ones when they conflict."
>
	<ol class="space-y-6">
		{#each PERSONALITY_TRAITS as trait (trait.rank)}
			<li class="flex gap-6 border-t border-border/60 pt-6 first:border-t-0 first:pt-0">
				<span class="brand-display w-8 text-4xl leading-none text-primary">{trait.rank}</span>
				<div>
					<p class="mb-2 text-lg font-semibold">{trait.name}</p>
					<p class="text-base leading-relaxed text-foreground/75">{trait.body}</p>
				</div>
			</li>
		{/each}
	</ol>
</BrandSection>

<BrandSection id="positioning" eyebrow="Positioning" title="Where we sit in the reader’s head.">
	<p class="brand-display mb-8 text-2xl leading-snug text-foreground lg:text-3xl">
		{POSITIONING.statement}
	</p>
	<dl class="space-y-3 border-t border-border/60 pt-6 text-sm text-muted-foreground">
		<div class="flex gap-3">
			<dt class="w-32 shrink-0 font-medium text-foreground">Category in</dt>
			<dd>{POSITIONING.inCategory}</dd>
		</div>
		<div class="flex gap-3">
			<dt class="w-32 shrink-0 font-medium text-foreground">Category not in</dt>
			<dd>{POSITIONING.notInCategory}</dd>
		</div>
		<div class="flex gap-3">
			<dt class="w-32 shrink-0 font-medium text-foreground">Frame</dt>
			<dd class="italic">{POSITIONING.frame}</dd>
		</div>
	</dl>
</BrandSection>

<BrandSection
	id="values"
	eyebrow="Values"
	title="Four we will live by."
	intro="Each value names a thing we will refuse to do."
>
	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		{#each VALUES as value (value.title)}
			<article class="rounded-2xl border border-border/60 bg-background p-6 lg:p-8">
				<h3 class="brand-display mb-3 text-2xl leading-tight">{value.title}</h3>
				<p class="text-sm leading-relaxed text-muted-foreground">{value.refusal}</p>
			</article>
		{/each}
	</div>
</BrandSection>

<BrandSection
	id="anti-brand"
	eyebrow="Anti-brand"
	title="What Cadenza is not."
	intro="Naming the anti-brand is as important as naming the brand. If someone describes us as any of these, the brand has failed in that conversation."
>
	<ul class="space-y-2">
		{#each ANTI_BRAND as line (line)}
			<li class="text-base leading-relaxed text-muted-foreground line-through decoration-1">
				{line}
			</li>
		{/each}
	</ul>
</BrandSection>
