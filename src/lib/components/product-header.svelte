<script lang="ts">
	import { page } from '$app/stores';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';

	// Create breadcrumb items based on current route
	const breadcrumbs = $derived(() => {
		const pathname = $page.url.pathname;
		const segments = pathname.split('/').filter(Boolean);

		if (segments.length === 0) return [];

		const items = [];

		// Always show "Product" as the root breadcrumb for product routes
		if (segments[0] === 'product') {
			items.push({
				label: 'Product',
				href: '/product',
				isLast: segments.length === 1
			});

			// Add subsequent segments
			if (segments.length > 1) {
				const lastSegment = segments[segments.length - 1];
				// Format the segment name (e.g., "community-chat" -> "Community Chat")
				const formattedLabel = lastSegment
					.split('-')
					.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
					.join(' ');

				items.push({
					label: formattedLabel,
					href: pathname,
					isLast: true
				});
			}
		}

		return items;
	});
</script>

<header
	class="group-has-data-[collapsible=icon]/sidebar-wrapper:h-12 flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear"
>
	<div class="flex items-center gap-2 px-4">
		<Sidebar.Trigger class="-ml-1" />
		<Separator orientation="vertical" class="mr-2 data-[orientation=vertical]:h-4" />
		<Breadcrumb.Root>
			<Breadcrumb.List>
				{#each breadcrumbs() as item, index}
					{#if index > 0}
						<Breadcrumb.Separator class="hidden md:block" />
					{/if}
					<Breadcrumb.Item class={index === 0 ? 'hidden md:block' : ''}>
						{#if item.isLast}
							<Breadcrumb.Page>{item.label}</Breadcrumb.Page>
						{:else}
							<Breadcrumb.Link href={item.href}>{item.label}</Breadcrumb.Link>
						{/if}
					</Breadcrumb.Item>
				{/each}
			</Breadcrumb.List>
		</Breadcrumb.Root>
	</div>
</header>
