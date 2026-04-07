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
	<p class="text-primary mb-6 text-xs tracking-[0.2em] uppercase">Cadenza — brand</p>
	<h1 class="brand-display mb-6 text-5xl leading-[1.05] text-balance lg:text-7xl">
		{TAGLINE}
	</h1>
</header>

<BrandSection id="the-name" eyebrow="The name" title="A moment, not a broadcast.">
	{#each NAME_STORY as paragraph (paragraph)}
		<p class="text-foreground/80 mb-4 text-lg leading-relaxed">{paragraph}</p>
	{/each}
</BrandSection>

<BrandSection id="the-observation" eyebrow="The observation" title={OBSERVATION.headline}>
	{#each OBSERVATION.body as paragraph (paragraph)}
		<p class="text-foreground/80 mb-4 text-lg leading-relaxed">{paragraph}</p>
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
			<article class="border-border/60 bg-background rounded-2xl border p-6 lg:p-8">
				<p class="text-primary mb-3 text-xs tracking-widest uppercase">
					Lens {lens.number} — {lens.thinker}
				</p>
				<h3 class="brand-display mb-4 text-2xl leading-tight lg:text-3xl">
					{lens.takeaway}
				</h3>
				{#each lens.body as paragraph (paragraph)}
					<p class="text-foreground/75 mb-3 text-sm leading-relaxed last:mb-0">
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
				<span class="text-primary brand-display text-2xl leading-none">{i + 1}</span>
				<div>
					<p class="mb-1 text-base font-semibold">{rule.title}</p>
					<p class="text-muted-foreground text-sm leading-relaxed">{rule.body}</p>
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
			<li class="border-border/60 flex gap-6 border-t pt-6 first:border-t-0 first:pt-0">
				<span class="text-primary brand-display w-8 text-4xl leading-none">{trait.rank}</span>
				<div>
					<p class="mb-2 text-lg font-semibold">{trait.name}</p>
					<p class="text-foreground/75 text-base leading-relaxed">{trait.body}</p>
				</div>
			</li>
		{/each}
	</ol>
</BrandSection>

<BrandSection id="positioning" eyebrow="Positioning" title="Where we sit in the reader’s head.">
	<p class="brand-display text-foreground mb-8 text-2xl leading-snug lg:text-3xl">
		{POSITIONING.statement}
	</p>
	<dl class="border-border/60 text-muted-foreground space-y-3 border-t pt-6 text-sm">
		<div class="flex gap-3">
			<dt class="text-foreground w-32 shrink-0 font-medium">Category in</dt>
			<dd>{POSITIONING.inCategory}</dd>
		</div>
		<div class="flex gap-3">
			<dt class="text-foreground w-32 shrink-0 font-medium">Category not in</dt>
			<dd>{POSITIONING.notInCategory}</dd>
		</div>
		<div class="flex gap-3">
			<dt class="text-foreground w-32 shrink-0 font-medium">Frame</dt>
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
			<article class="border-border/60 bg-background rounded-2xl border p-6 lg:p-8">
				<h3 class="brand-display mb-3 text-2xl leading-tight">{value.title}</h3>
				<p class="text-muted-foreground text-sm leading-relaxed">{value.refusal}</p>
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
			<li class="text-muted-foreground text-base leading-relaxed line-through decoration-1">
				{line}
			</li>
		{/each}
	</ul>
</BrandSection>
