<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import BrandSection from '$lib/components/brand/brand-section.svelte';
	import { CopyButton } from '$lib/components/ui/copy-button';
	import { BRAND_COLORS } from '$lib/brand/colors';
	import { TYPE_SCALE } from '$lib/brand/typography';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

	const cssTokens = $derived(
		[':root {', ...BRAND_COLORS.map((c) => `\t${c.token}: ${c.oklch}; /* ${c.name} */`), '}'].join(
			'\n'
		)
	);

	const typeCss = $derived(
		[':root {', ...TYPE_SCALE.map((t) => `\t--${t.token}: ${t.px}px; /* ${t.font} */`), '}'].join(
			'\n'
		)
	);

	const fontFiles = [
		{ label: 'Fraunces italic 400', path: '/fonts/fraunces-latin-400-italic.woff2' },
		{ label: 'Fraunces italic 700', path: '/fonts/fraunces-latin-700-italic.woff2' },
		{ label: 'Geist Sans 400', path: '/fonts/geist-sans-latin-400-normal.woff2' },
		{ label: 'Geist Sans 500', path: '/fonts/geist-sans-latin-500-normal.woff2' },
		{ label: 'Geist Sans 600', path: '/fonts/geist-sans-latin-600-normal.woff2' }
	] as const;
</script>

<SEOHead
	title={$t('meta.brand_resources.title')}
	description={$t('meta.brand_resources.description')}
/>

<header class="pb-12">
	<p class="text-primary mb-4 text-xs tracking-[0.2em] uppercase">Resources</p>
	<h1 class="brand-display text-5xl leading-[1.05] lg:text-6xl">Everything, copy-pasteable.</h1>
</header>

<BrandSection id="color-tokens" eyebrow="Color tokens" title="CSS custom properties.">
	<div class="border-border/60 bg-background relative overflow-hidden rounded-2xl border">
		<div class="absolute top-4 right-4">
			<CopyButton text={cssTokens} variant="outline" size="icon" class="size-8" />
		</div>
		<pre class="text-foreground/90 overflow-x-auto p-5 pr-14 text-xs leading-relaxed"><code
				>{cssTokens}</code
			></pre>
	</div>
</BrandSection>

<BrandSection id="type-tokens" eyebrow="Type tokens" title="Type scale as CSS variables.">
	<div class="border-border/60 bg-background relative overflow-hidden rounded-2xl border">
		<div class="absolute top-4 right-4">
			<CopyButton text={typeCss} variant="outline" size="icon" class="size-8" />
		</div>
		<pre class="text-foreground/90 overflow-x-auto p-5 pr-14 text-xs leading-relaxed"><code
				>{typeCss}</code
			></pre>
	</div>
</BrandSection>

<BrandSection
	id="fonts"
	eyebrow="Fonts"
	title="Self-hosted woff2."
	intro="All five files are shipped with the project and served from /fonts/. Click to download."
>
	<ul
		class="border-border/60 bg-background divide-border/60 divide-y overflow-hidden rounded-2xl border"
	>
		{#each fontFiles as file (file.path)}
			<li class="flex items-center justify-between gap-4 px-5 py-4">
				<div>
					<p class="text-sm font-medium">{file.label}</p>
					<code class="text-muted-foreground text-xs">{file.path}</code>
				</div>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- static asset download, not route navigation -->
				<a href={file.path} download class="text-primary hover:text-primary/80 text-sm font-medium">
					Download
				</a>
			</li>
		{/each}
	</ul>
</BrandSection>

<BrandSection id="logo-kit" eyebrow="Logo" title="Rendered, not downloaded.">
	<p class="text-foreground/80 mb-4 text-base leading-relaxed">
		The Cadenza wordmark is rendered live from Fraunces italic — there is no bitmap. To use it:
	</p>
	<ol class="text-foreground/80 list-inside list-decimal space-y-2 text-sm">
		<li>Install Fraunces (italic, 400 weight) from Google Fonts or fontsource.</li>
		<li>
			Set the wordmark as lowercase text: <code class="bg-muted/50 rounded px-1.5 py-0.5 text-xs"
				>cadenza</code
			>.
		</li>
		<li>Font family Fraunces, style italic, weight 400.</li>
		<li>
			For the gradient mark, apply a 135° linear gradient from <code
				class="bg-muted/50 rounded px-1.5 py-0.5 text-xs">#1A1A1A</code
			>
			to <code class="bg-muted/50 rounded px-1.5 py-0.5 text-xs">#C75B39</code> with background-clip:
			text.
		</li>
	</ol>
</BrandSection>
