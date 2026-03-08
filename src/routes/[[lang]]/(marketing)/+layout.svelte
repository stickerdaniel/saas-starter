<script lang="ts">
	import PostHogIdentify from '$lib/components/analytics/PostHogIdentify.svelte';
	import SupportTicketMigrationBootstrap from '$lib/components/customer-support/support-ticket-migration-bootstrap.svelte';
	import MarketingHeader from '$lib/components/marketing/marketing-header.svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
	}

	let { children }: Props = $props();
</script>

<PostHogIdentify />
<SupportTicketMigrationBootstrap />
<MarketingHeader />
<div class="pt-4 sm:pt-0">
	{@render children?.()}
</div>
