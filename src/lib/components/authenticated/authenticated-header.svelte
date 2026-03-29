<script lang="ts">
	import { page } from '$app/state';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import LanguageSwitcher from '$lib/components/LanguageSwitcher.svelte';
	import LightSwitch from '$lib/components/ui/light-switch/light-switch.svelte';
	import CommandTrigger from '$lib/components/global-search/command-trigger.svelte';
	import { localizedHref } from '$lib/utils/i18n';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

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
		const first = segments[0]!;
		if (first === routePrefix || (first.length === 2 && segments[1] === routePrefix)) {
			items.push({
				label: rootLabel,
				href: localizedHref(`/${routePrefix}`),
				isLast: segments.length === 1 || (first.length === 2 && segments.length === 2)
			});

			// Add subsequent segments (skip language segment if present)
			const prefixSegmentIndex = first === routePrefix ? 0 : 1;
			if (segments.length > prefixSegmentIndex + 1) {
				const lastSegment = segments[segments.length - 1]!;
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
	class="flex h-16 shrink-0 items-center gap-2 border-b bg-sidebar/30 transition-[width,height] ease-sidebar group-has-data-[collapsible=icon]/sidebar-wrapper:h-12"
>
	<div class="flex w-full items-center gap-2 px-4">
		<Sidebar.Trigger class="-ml-1" />
		<Separator orientation="vertical" class="mr-2 data-[orientation=vertical]:h-4" />
		<Breadcrumb.Root class="min-w-0">
			<Breadcrumb.List class="flex-nowrap truncate">
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
			<Button
				variant="ghost"
				size="icon"
				href="https://github.com/stickerdaniel/saas-starter"
				target="_blank"
				rel="noopener noreferrer"
				aria-label={$t('aria.github_repository')}
				class="size-8"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="24"
					height="24"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="size-4"
					aria-hidden="true"
				>
					<path
						d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"
					/>
					<path d="M9 18c-4.51 2-5-2-7-2" />
				</svg>
			</Button>
			<LightSwitch variant="ghost" />
			<LanguageSwitcher variant="ghost" />
		</div>
	</div>
</header>
