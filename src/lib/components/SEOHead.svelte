<script lang="ts">
	import { page } from '$app/stores';
	import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from '$lib/i18n/languages';

	interface Props {
		/** Page title (without site name suffix) */
		title?: string;
		/** Meta description */
		description?: string;
		/** Custom canonical URL (optional, defaults to current page) */
		canonicalUrl?: string;
	}

	let { title, description, canonicalUrl }: Props = $props();

	// Get current language and path
	let currentLang = $derived($page.params.lang || DEFAULT_LANGUAGE);
	let currentPath = $derived($page.url.pathname);
	let origin = $derived($page.url.origin);

	// Generate path without language prefix for alternate links
	let pathWithoutLang = $derived(() => {
		if (currentPath.startsWith(`/${currentLang}`)) {
			return currentPath.replace(`/${currentLang}`, '') || '/';
		}
		return currentPath;
	});

	// Generate canonical URL
	let canonical = $derived(
		canonicalUrl || `${origin}/${currentLang}${pathWithoutLang() === '/' ? '' : pathWithoutLang()}`
	);
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

	<!-- Hreflang tags for each language -->
	{#each SUPPORTED_LANGUAGES as language (language.code)}
		<link
			rel="alternate"
			hreflang={language.code}
			href="{origin}/{language.code}{pathWithoutLang() === '/' ? '' : pathWithoutLang()}"
		/>
	{/each}

	<!-- x-default hreflang for default language -->
	<link
		rel="alternate"
		hreflang="x-default"
		href="{origin}/{DEFAULT_LANGUAGE}{pathWithoutLang() === '/' ? '' : pathWithoutLang()}"
	/>

	<!-- Language metadata -->
	<meta property="og:locale" content={currentLang} />
	{#each SUPPORTED_LANGUAGES.filter((l) => l.code !== currentLang) as language (language.code)}
		<meta property="og:locale:alternate" content={language.code} />
	{/each}
</svelte:head>
