<script lang="ts">
	import { page } from '$app/state';
	import { PUBLIC_SITE_URL } from '$env/static/public';
	import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, getLanguage } from '$lib/i18n/languages';
	import { LEGAL_CONFIG } from '$lib/config/legal';

	// During prerendering page.url.origin is SvelteKit's placeholder
	// http://sveltekit-prerender, so absolute SEO URLs must come from the
	// configured site origin when available. Trailing slash is stripped to
	// avoid double slashes in `${origin}${image}` and `${origin}/${lang}`.
	const configuredOrigin = PUBLIC_SITE_URL.replace(/\/$/, '');

	interface Props {
		/** Page title (without site name suffix) */
		title?: string;
		/** Meta description */
		description?: string;
		/** Custom canonical URL (optional, defaults to current page) */
		canonicalUrl?: string;
		/** Open Graph type (defaults to "website") */
		ogType?: string;
		/** OG/Twitter image path relative to static/ (e.g. "/og-image.png").
		 * Will be converted to an absolute URL using the current origin.
		 * Defaults to /og-image.png (1200x630). */
		image?: string;
		/** OG image width in pixels (defaults to 1200 for the default image only) */
		imageWidth?: number;
		/** OG image height in pixels (defaults to 630 for the default image only) */
		imageHeight?: number;
		/** Localized alt text for the OG/Twitter image */
		imageAlt?: string;
		/** Mark the page as noindex/nofollow and drop canonical/hreflang/og:url
		 * (private routes: auth, app, admin) */
		noindex?: boolean;
	}

	let {
		title,
		description,
		canonicalUrl,
		ogType = 'website',
		image = '/og-image.png',
		imageWidth,
		imageHeight,
		imageAlt,
		noindex = false
	}: Props = $props();

	// Get current language and path
	let currentLang = $derived(page.params.lang || DEFAULT_LANGUAGE);
	let currentPath = $derived(page.url.pathname);
	let origin = $derived(configuredOrigin || page.url.origin);

	// Generate path without language prefix for alternate links
	let pathWithoutLang = $derived.by(() => {
		if (currentPath.startsWith(`/${currentLang}`)) {
			return currentPath.replace(`/${currentLang}`, '') || '/';
		}
		return currentPath;
	});

	// Generate canonical URL
	let canonical = $derived(
		canonicalUrl || `${origin}/${currentLang}${pathWithoutLang === '/' ? '' : pathWithoutLang}`
	);

	// og:image must be an absolute URL for social sharing crawlers
	let absoluteImageUrl = $derived(image ? `${origin}${image}` : undefined);

	// Only the bundled default og-image has known dimensions (1200x630).
	// Custom images keep dimensions undefined unless explicitly provided.
	const isDefaultImage = $derived(image === '/og-image.png');
	const ogImageWidth = $derived(imageWidth ?? (isDefaultImage ? 1200 : undefined));
	const ogImageHeight = $derived(imageHeight ?? (isDefaultImage ? 630 : undefined));
</script>

<svelte:head>
	{#if title}
		<title>{title} | {LEGAL_CONFIG.brandName}</title>
		<meta property="og:title" content={title} />
		<meta name="twitter:title" content={title} />
	{/if}

	{#if description}
		<meta name="description" content={description} />
		<meta property="og:description" content={description} />
		<meta name="twitter:description" content={description} />
	{/if}

	{#if noindex}
		<!-- Private route: keep crawlers out and skip canonical/hreflang -->
		<meta name="robots" content="noindex, nofollow" />
	{/if}

	{#if !noindex}
		<!-- Canonical URL -->
		<link rel="canonical" href={canonical} />
		<meta property="og:url" content={canonical} />
	{/if}

	<!-- Open Graph type & image -->
	<meta property="og:type" content={ogType} />
	<meta property="og:site_name" content={LEGAL_CONFIG.brandName} />
	{#if absoluteImageUrl}
		<meta property="og:image" content={absoluteImageUrl} />
		{#if ogImageWidth}<meta property="og:image:width" content={String(ogImageWidth)} />{/if}
		{#if ogImageHeight}<meta property="og:image:height" content={String(ogImageHeight)} />{/if}
		{#if imageAlt}<meta property="og:image:alt" content={imageAlt} />{/if}
	{/if}

	<!-- Twitter card -->
	<meta name="twitter:card" content={absoluteImageUrl ? 'summary_large_image' : 'summary'} />
	{#if absoluteImageUrl}
		<meta name="twitter:image" content={absoluteImageUrl} />
		{#if imageAlt}<meta name="twitter:image:alt" content={imageAlt} />{/if}
	{/if}

	{#if !noindex}
		<!-- Hreflang tags for each language -->
		{#each SUPPORTED_LANGUAGES as language (language.code)}
			<link
				rel="alternate"
				hreflang={language.code}
				href="{origin}/{language.code}{pathWithoutLang === '/' ? '' : pathWithoutLang}"
			/>
		{/each}

		<!-- x-default hreflang for default language -->
		<link
			rel="alternate"
			hreflang="x-default"
			href="{origin}/{DEFAULT_LANGUAGE}{pathWithoutLang === '/' ? '' : pathWithoutLang}"
		/>
	{/if}

	<!-- Language metadata -->
	<meta property="og:locale" content={getLanguage(currentLang).ogLocale} />
	{#if !noindex}
		{#each SUPPORTED_LANGUAGES.filter((l) => l.code !== currentLang) as language (language.code)}
			<meta property="og:locale:alternate" content={language.ogLocale} />
		{/each}
	{/if}
</svelte:head>
