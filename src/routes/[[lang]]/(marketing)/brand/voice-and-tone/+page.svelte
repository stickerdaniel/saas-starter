<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import BrandSection from '$lib/components/brand/brand-section.svelte';
	import DoDont from '$lib/components/brand/do-dont.svelte';
	import { VOICE_RULES, VOCABULARY, TONE_SPECTRUM } from '$lib/brand/brand-config';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();
</script>

<SEOHead
	title={$t('meta.brand_voice_and_tone.title')}
	description={$t('meta.brand_voice_and_tone.description')}
/>

<header class="pb-12">
	<p class="text-primary mb-4 text-xs tracking-[0.2em] uppercase">Voice & tone</p>
	<h1 class="brand-display text-5xl leading-[1.05] lg:text-6xl">One voice. Four dial positions.</h1>
</header>

<BrandSection id="voice-rules" eyebrow="The voice" title="Six rules for every line we write.">
	<ol class="space-y-6">
		{#each VOICE_RULES as rule (rule.number)}
			<li class="border-border/60 flex gap-5 border-t pt-6 first:border-t-0 first:pt-0">
				<span class="text-primary brand-display w-10 text-3xl leading-none">{rule.number}</span>
				<div>
					<p class="mb-2 text-lg font-semibold">{rule.rule}</p>
					<p class="text-foreground/75 text-base leading-relaxed">{rule.body}</p>
				</div>
			</li>
		{/each}
	</ol>
</BrandSection>

<BrandSection id="vocabulary" eyebrow="Vocabulary" title="The words we use. The words we don’t.">
	<div class="border-border/60 bg-background overflow-hidden rounded-2xl border">
		<table class="w-full text-left">
			<thead class="text-muted-foreground border-border/60 border-b text-xs uppercase">
				<tr>
					<th class="px-5 py-3 font-medium">We say</th>
					<th class="px-5 py-3 font-medium">We don’t say</th>
				</tr>
			</thead>
			<tbody>
				{#each VOCABULARY as pair (pair.say)}
					<tr class="border-border/40 border-b last:border-b-0">
						<td class="px-5 py-4 text-sm font-medium">{pair.say}</td>
						<td class="text-muted-foreground px-5 py-4 text-sm line-through decoration-1">
							{pair.dontSay}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</BrandSection>

<BrandSection
	id="tone-spectrum"
	eyebrow="Tone spectrum"
	title="Same voice. Different rooms."
	intro="The voice never changes. Only the dial."
>
	<div class="space-y-5">
		{#each TONE_SPECTRUM as register (register.context)}
			<article class="border-border/60 bg-background rounded-2xl border p-6 lg:p-8">
				<div class="mb-4 flex flex-wrap items-baseline justify-between gap-2">
					<h3 class="text-lg font-semibold">{register.context}</h3>
					<p class="text-muted-foreground text-xs tracking-wider uppercase">
						{register.dialPosition}
					</p>
				</div>
				<p class="brand-display text-foreground text-xl leading-snug lg:text-2xl">
					“{register.example}”
				</p>
			</article>
		{/each}
	</div>
</BrandSection>

<BrandSection
	id="do-dont"
	eyebrow="Do / don’t"
	title="Worked examples."
	intro="The same message written in the Cadenza voice, and the SaaS voice we will never use."
>
	<div class="space-y-4">
		<DoDont
			label="Hero headline"
			doText="LinkedIn outreach that reads the room."
			dontText="Revolutionary AI-powered outreach that unlocks 10x growth."
		/>
		<DoDont label="Button label" doText="Read profile" dontText="Unlock AI-powered insights" />
		<DoDont
			label="Error message"
			doText="We couldn’t reach LinkedIn. Try again in a minute — nothing was sent."
			dontText="Oops! Something went wrong. Please try again later."
		/>
		<DoDont
			label="Empty state"
			doText="Paste a profile to start. Cadenza will read it before it suggests anything."
			dontText="Welcome! Get started by adding your first lead 🚀"
		/>
	</div>
</BrandSection>
