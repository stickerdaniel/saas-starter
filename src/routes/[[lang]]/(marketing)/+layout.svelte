<script lang="ts">
	import { page } from '$app/state';
	import { PUBLIC_SITE_URL } from '$env/static/public';
	import PostHogIdentify from '$lib/components/analytics/PostHogIdentify.svelte';
	import SupportTicketMigrationBootstrap from '$lib/components/customer-support/support-ticket-migration-bootstrap.svelte';
	import MarketingFooter from '$lib/components/marketing/marketing-footer.svelte';
	import MarketingHeader from '$lib/components/marketing/marketing-header.svelte';
	import { LEGAL_CONFIG } from '$lib/config/legal';
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
	}

	let { children }: Props = $props();

	// Prerender-safe absolute origin (mirrors SEOHead): PUBLIC_SITE_URL when set,
	// else the request origin. Trailing slash stripped to avoid double slashes.
	const origin = $derived(PUBLIC_SITE_URL.replace(/\/$/, '') || page.url.origin);

	// schema.org JSON-LD (Organization + WebSite); built from trusted config values.
	const jsonLd = $derived(
		JSON.stringify({
			'@context': 'https://schema.org',
			'@graph': [
				{
					'@type': 'Organization',
					name: LEGAL_CONFIG.brandName,
					url: origin,
					logo: `${origin}/logo-email.png`
				},
				{ '@type': 'WebSite', name: LEGAL_CONFIG.brandName, url: origin }
			]
		})
	);
</script>

<svelte:head>
	<!-- eslint-disable-next-line svelte/no-at-html-tags, no-useless-escape -- JSON-LD payload is built from trusted config values, not user input -->
	{@html `<script type="application/ld+json">${jsonLd}<\/script>`}
</svelte:head>

<PostHogIdentify />
<SupportTicketMigrationBootstrap />
<MarketingHeader />
<div class="flex min-h-svh flex-col pt-4 sm:pt-0">
	<main id="main-content" class="flex-1">
		{@render children?.()}
	</main>
	<MarketingFooter />
</div>
