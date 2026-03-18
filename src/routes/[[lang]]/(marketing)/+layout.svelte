<script lang="ts">
	import PostHogIdentify from '$lib/components/analytics/PostHogIdentify.svelte';
	import SupportTicketMigrationBootstrap from '$lib/components/customer-support/support-ticket-migration-bootstrap.svelte';
	import MarketingFooter from '$lib/components/marketing/marketing-footer.svelte';
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
<div class="flex min-h-screen flex-col pt-4 sm:pt-0">
	<div class="flex-1">
		{@render children?.()}
	</div>
	<MarketingFooter />
</div>
