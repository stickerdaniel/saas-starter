<script lang="ts">
	import { page } from '$app/state';
	import {
		SUPPORTED_LANGUAGES,
		DEFAULT_LANGUAGE,
		getLanguage,
		type LanguageCode
	} from '#lib/i18n/languages.js';
	import { LEGAL_CONFIG, getLegalEmailAddress } from '#lib/config/legal.js';
	import { resolveSiteOrigin } from '#lib/config/site-origin.js';
	import { SITE_CONFIG, getRepositoryUrl } from '#lib/config/site.js';
	import { buildSiteStructuredData, serializeStructuredData } from '#lib/seo/structured-data.js';
	import { OG_IMAGE_URL } from './og-image-url.generated';

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
		 * Defaults to the bundled og-image.png (1200x630), carrying the content
		 * hash that busts the social platforms' image caches. */
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
		/** Emit the WebSite and Organization JSON-LD graph on the localized homepage. */
		siteStructuredData?: boolean;
		/** Languages this page exists in, the default one included, for hreflang and Open Graph locales */
		languages?: readonly LanguageCode[];
	}

	let {
		title,
		description,
		canonicalUrl,
		ogType = 'website',
		image = OG_IMAGE_URL,
		imageWidth,
		imageHeight,
		imageAlt,
		noindex = false,
		siteStructuredData = false,
		languages = SUPPORTED_LANGUAGES.map((language) => language.code)
	}: Props = $props();

	// Get current language and path
	let currentLang = $derived(page.params.lang || DEFAULT_LANGUAGE);
	let currentPath = $derived(page.url.pathname);
	let localeLang = $derived(
		languages.find((language) => language === currentLang) ?? DEFAULT_LANGUAGE
	);
	let origin = $derived(resolveSiteOrigin(page.url.origin));

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
	const isDefaultImage = $derived(image === OG_IMAGE_URL);
	const ogImageWidth = $derived(imageWidth ?? (isDefaultImage ? 1200 : undefined));
	const ogImageHeight = $derived(imageHeight ?? (isDefaultImage ? 630 : undefined));
	const siteJsonLd = $derived.by(() => {
		if (!siteStructuredData || !description) return null;
		return serializeStructuredData(
			buildSiteStructuredData({
				origin,
				name: LEGAL_CONFIG.brandName,
				description,
				languages: SUPPORTED_LANGUAGES.map((language) => language.code),
				repositoryUrl: getRepositoryUrl(),
				legal: {
					companyName: LEGAL_CONFIG.companyName,
					operatorName: LEGAL_CONFIG.operatorName,
					address: LEGAL_CONFIG.address,
					email: getLegalEmailAddress()
				},
				...SITE_CONFIG.structuredData
			})
		);
	});
</script>

<svelte:head>
	<!-- The brand is appended here, so the `title` prop and every meta.*.title in
	     src/i18n must be page-name only. A title that already ends in the brand
	     renders it twice ("Pricing | Brand | Brand"). The meta-title unit test
	     guards the i18n side. -->
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
		{#each languages as language (language)}
			<link
				rel="alternate"
				hreflang={language}
				href="{origin}/{language}{pathWithoutLang === '/' ? '' : pathWithoutLang}"
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
	<meta property="og:locale" content={getLanguage(localeLang).ogLocale} />
	{#if !noindex}
		{#each languages.filter((language) => language !== localeLang) as language (language)}
			<meta property="og:locale:alternate" content={getLanguage(language).ogLocale} />
		{/each}
	{/if}

	{#if siteJsonLd}
		<!-- serializeStructuredData escapes < > & and the line separators, so the payload
		     cannot close this tag. The closing tag itself keeps its backslash: Svelte's
		     parser ends the markup region at a literal </script> even inside a template
		     literal, and dropping it is a parse error, not a useless escape. -->
		<!-- eslint-disable-next-line svelte/no-at-html-tags, no-useless-escape -- see above -->
		{@html `<script type="application/ld+json">${siteJsonLd}<\/script>`}
	{/if}
</svelte:head>
