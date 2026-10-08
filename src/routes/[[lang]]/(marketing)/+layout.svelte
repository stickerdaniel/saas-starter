<script lang="ts">
	import SupportTicketMigrationBootstrap from '#lib/components/customer-support/support-ticket-migration-bootstrap.svelte';
	import MarketingFooter from '#lib/components/marketing/marketing-footer.svelte';
	import MarketingHeader from '#lib/components/marketing/marketing-header.svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
	}

	let { children }: Props = $props();
</script>

<SupportTicketMigrationBootstrap />
<MarketingHeader />
<div class="flex min-h-svh-below-notices flex-col pt-4 sm:pt-0">
	<main id="main-content" class="flex-1">
		{@render children?.()}
	</main>
	<MarketingFooter />
</div>
