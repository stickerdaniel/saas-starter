<script lang="ts">
	import { page } from '$app/state';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import LanguageSwitcher from '$lib/components/LanguageSwitcher.svelte';
	import LightSwitch from '$lib/components/ui/light-switch/light-switch.svelte';
	import { localizedHref } from '$lib/utils/i18n';

	// Create breadcrumb items based on current route
	const breadcrumbs = $derived.by(() => {
		const pathname = page.url.pathname;
		const segments = pathname.split('/').filter(Boolean);

		if (segments.length === 0) return [];

		const items = [];

		// Always show "Admin" as the root breadcrumb for admin routes
		if (segments[0] === 'admin' || (segments[0].length === 2 && segments[1] === 'admin')) {
			items.push({
				label: 'Admin',
				href: localizedHref('/admin'),
				isLast: segments.length === 1 || (segments[0].length === 2 && segments.length === 2)
			});

			// Add subsequent segments (skip language segment if present)
			const adminSegmentIndex = segments[0] === 'admin' ? 0 : 1;
			if (segments.length > adminSegmentIndex + 1) {
				const lastSegment = segments[segments.length - 1];
				// Format the segment name (e.g., "users" -> "Users")
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
	class="flex h-16 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12"
>
	<div class="flex w-full items-center gap-2 px-4">
		<Sidebar.Trigger class="-ml-1" />
		<Separator orientation="vertical" class="mr-2 data-[orientation=vertical]:h-4" />
		<Breadcrumb.Root>
			<Breadcrumb.List>
				{#each breadcrumbs as item, index}
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
		<div class="ml-auto flex items-center gap-2">
			<LightSwitch variant="ghost" />
			<LanguageSwitcher variant="ghost" />
		</div>
	</div>
</header>
