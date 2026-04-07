<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import BrandSection from '$lib/components/brand/brand-section.svelte';
	import ColorPalette from '$lib/components/brand/color-palette.svelte';
	import TypographySpecimen from '$lib/components/brand/typography-specimen.svelte';
	import DoDont from '$lib/components/brand/do-dont.svelte';
	import { BRAND_COLOR_USAGE_RULES } from '$lib/brand/colors';
	import { FONTS, TYPE_SCALE, TYPE_RULES } from '$lib/brand/typography';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();
</script>

<SEOHead
	title={$t('meta.brand_visual_identity.title')}
	description={$t('meta.brand_visual_identity.description')}
/>

<header class="pb-12">
	<p class="text-primary mb-4 text-xs tracking-[0.2em] uppercase">Visual identity</p>
	<h1 class="brand-display text-5xl leading-[1.05] lg:text-6xl">Logo, color, type.</h1>
</header>

<BrandSection id="logo" eyebrow="Logo" title="A lowercase italic c, earned in one glance.">
	<div
		class="border-border/60 bg-background mb-6 flex aspect-[16/9] items-center justify-center rounded-2xl border"
	>
		<div class="flex items-baseline gap-3">
			<span
				class="brand-display text-8xl leading-none lg:text-9xl"
				style="background: linear-gradient(135deg, var(--color-brand-ink) 0%, var(--color-brand-terracotta) 100%); -webkit-background-clip: text; background-clip: text; color: transparent;"
			>
				c
			</span>
			<span class="brand-display text-5xl leading-none lg:text-6xl">adenza</span>
		</div>
	</div>
	<ul class="text-foreground/80 space-y-2 text-sm">
		<li>— Mark: lowercase italic <em>c</em> in Fraunces on an ink → terracotta gradient (135°).</li>
		<li>
			— Wordmark: <em>cadenza</em>, lowercase, Fraunces italic. Never caps. Never another font.
		</li>
		<li>— Clear space equals the height of the mark on all sides.</li>
		<li>— Minimum size: 24px tall on screen, 8mm in print.</li>
		<li>— Monochrome variants only: ink on warm white, warm white on ink.</li>
	</ul>
</BrandSection>

<BrandSection id="logo-rules" eyebrow="Logo do / don’t">
	<div class="space-y-4">
		<DoDont
			label="Case"
			doText="cadenza — lowercase, Fraunces italic"
			dontText="CADENZA — set in uppercase"
		/>
		<DoDont
			label="Typeface"
			doText="Wordmark always set in Fraunces italic"
			dontText="Wordmark substituted with any other font"
		/>
		<DoDont
			label="Treatment"
			doText="Clean mark on warm white or ink"
			dontText="Drop shadows, glows, bevels, outlines"
		/>
		<DoDont
			label="Scale"
			doText="Proportional scaling, clear space preserved"
			dontText="Stretched, condensed, rotated, or crowded"
		/>
	</div>
</BrandSection>

<BrandSection
	id="color"
	eyebrow="Color system"
	title="Five tokens. Terracotta is the punctuation."
	intro="Every swatch below ships as a CSS custom property. Click a value to copy it."
>
	<ColorPalette />
	<ul
		class="border-border/60 text-foreground/80 mt-10 space-y-2 border-t pt-8 text-sm leading-relaxed"
	>
		{#each BRAND_COLOR_USAGE_RULES as rule (rule)}
			<li>— {rule}</li>
		{/each}
	</ul>
</BrandSection>

<BrandSection
	id="typography"
	eyebrow="Typography"
	title="The voice and the room."
	intro="Fraunces is the voice. Geist Sans is the room. The product literally shows the difference between speaking and being in the room — the typography embodies the brand thesis."
>
	<div class="mb-10 grid grid-cols-1 gap-5">
		{#each FONTS as font (font.name)}
			<TypographySpecimen {font} />
		{/each}
	</div>

	<h3 class="brand-display mb-6 text-2xl lg:text-3xl">Type scale</h3>
	<div class="border-border/60 bg-background overflow-hidden rounded-2xl border">
		<table class="w-full text-left text-sm">
			<thead class="text-muted-foreground border-border/60 border-b text-xs uppercase">
				<tr>
					<th class="px-5 py-3 font-medium">Token</th>
					<th class="px-5 py-3 font-medium">Size</th>
					<th class="px-5 py-3 font-medium">Font</th>
					<th class="hidden px-5 py-3 font-medium md:table-cell">Use</th>
				</tr>
			</thead>
			<tbody>
				{#each TYPE_SCALE as token (token.token)}
					<tr class="border-border/40 border-b last:border-b-0">
						<td class="px-5 py-4"><code class="text-xs">{token.token}</code></td>
						<td class="px-5 py-4">{token.px}px</td>
						<td class="px-5 py-4">{token.font}</td>
						<td class="text-muted-foreground hidden px-5 py-4 md:table-cell">{token.use}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<ul class="text-muted-foreground mt-6 space-y-1 text-sm">
		{#each TYPE_RULES as rule (rule)}
			<li>— {rule}</li>
		{/each}
	</ul>
</BrandSection>
