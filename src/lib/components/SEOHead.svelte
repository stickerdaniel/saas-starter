<script lang="ts">
	import { page } from '$app/state';
	import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from '$lib/i18n/languages';

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
	}

	let {
		title,
		description,
		canonicalUrl,
		ogType = 'website',
		image = '/og-image.png'
	}: Props = $props();

	// Get current language and path
	let currentLang = $derived(page.params.lang || DEFAULT_LANGUAGE);
	let currentPath = $derived(page.url.pathname);
	let origin = $derived(page.url.origin);

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
</script>

<svelte:head>
	{#if title}
		<title>{title} | SaaS Starter</title>
		<meta property="og:title" content={title} />
		<meta name="twitter:title" content={title} />
	{/if}

	{#if description}
		<meta name="description" content={description} />
		<meta property="og:description" content={description} />
		<meta name="twitter:description" content={description} />
	{/if}

	<!-- Canonical URL -->
	<link rel="canonical" href={canonical} />
	<meta property="og:url" content={canonical} />

	<!-- Open Graph type & image -->
	<meta property="og:type" content={ogType} />
	{#if absoluteImageUrl}
		<meta property="og:image" content={absoluteImageUrl} />
	{/if}

	<!-- Twitter card -->
	<meta name="twitter:card" content={absoluteImageUrl ? 'summary_large_image' : 'summary'} />
	{#if absoluteImageUrl}
		<meta name="twitter:image" content={absoluteImageUrl} />
	{/if}

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

	<!-- Language metadata -->
	<meta property="og:locale" content={currentLang} />
	{#each SUPPORTED_LANGUAGES.filter((l) => l.code !== currentLang) as language (language.code)}
		<meta property="og:locale:alternate" content={language.code} />
	{/each}
</svelte:head>
