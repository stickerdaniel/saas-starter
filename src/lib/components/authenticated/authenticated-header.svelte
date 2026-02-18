<script lang="ts">
	import { page } from '$app/state';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import LanguageSwitcher from '$lib/components/LanguageSwitcher.svelte';
	import LightSwitch from '$lib/components/ui/light-switch/light-switch.svelte';
	import CommandTrigger from '$lib/components/global-search/command-trigger.svelte';
	import { localizedHref } from '$lib/utils/i18n';
	import { isResourceName } from '$lib/admin/registry';

	const ADMIN_STATIC_SEGMENTS = new Set(['create', 'edit']);

	interface Props {
		routePrefix: string;
		rootLabel: string;
	}

	let { routePrefix, rootLabel }: Props = $props();

	// Create breadcrumb items based on current route
	const breadcrumbs = $derived.by(() => {
		const pathname = page.url.pathname;
		const segments = pathname.split('/').filter(Boolean);

		if (segments.length === 0) return [];

		const items: { label: string; href: string; isLast: boolean }[] = [];

		// Check if current route matches the prefix
		if (segments[0] === routePrefix || (segments[0].length === 2 && segments[1] === routePrefix)) {
			items.push({
				label: rootLabel,
				href: localizedHref(`/${routePrefix}`),
				isLast: segments.length === 1 || (segments[0].length === 2 && segments.length === 2)
			});

			// Add all subsequent segments (skip language segment if present)
			const prefixSegmentIndex = segments[0] === routePrefix ? 0 : 1;
			const startIndex = prefixSegmentIndex + 1;
			for (let i = startIndex; i < segments.length; i++) {
				const seg = segments[i];
				let label: string;
				if (routePrefix === 'admin' && !isResourceName(seg) && !ADMIN_STATIC_SEGMENTS.has(seg)) {
					label = 'Details';
				} else {
					label = seg
						.split('-')
						.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
						.join(' ');
				}
				const href = '/' + segments.slice(0, i + 1).join('/');
				items.push({ label, href, isLast: i === segments.length - 1 });
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
				{#each breadcrumbs as item, index (item.href)}
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
			<CommandTrigger class="hidden md:inline-flex" />
			<LightSwitch variant="ghost" />
			<LanguageSwitcher variant="ghost" />
		</div>
	</div>
</header>
