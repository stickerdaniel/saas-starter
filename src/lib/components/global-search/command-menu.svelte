<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as Command from '$lib/components/ui/command/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Kbd from '$lib/components/ui/kbd/index.js';
	import { localizedHref } from '$lib/utils/i18n';
	import { getTranslate } from '@tolgee/svelte';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import CornerDownLeftIcon from '@lucide/svelte/icons/corner-down-left';
	import CommandMenuItem from './command-menu-item.svelte';
	import {
		SEARCH_ROUTES,
		titleizeRouteFromHref,
		type SearchRouteEntry,
		type SearchRouteGroup
	} from './search-routes';
	import { useGlobalSearchContext } from './context.svelte';

	interface Props {
		isAuthenticated: boolean;
		userRole?: string | null;
	}

	type MenuRouteItem = SearchRouteEntry & {
		id: string;
		label: string;
		localizedUrl: string;
		value: string;
		keywords: string[];
	};

	type MenuGroup = {
		group: SearchRouteGroup;
		heading: string;
		items: MenuRouteItem[];
	};

	const { t } = getTranslate();

	let { isAuthenticated = false, userRole = null }: Props = $props();

	const globalSearch = useGlobalSearchContext();

	const groupOrder: SearchRouteGroup[] = ['public', 'authentication', 'app', 'admin'];
	const groupKeyMap: Record<SearchRouteGroup, string> = {
		public: 'search.command.groups.public',
		authentication: 'search.command.groups.authentication',
		app: 'search.command.groups.app',
		admin: 'search.command.groups.admin'
	};

	function hasAccess(access: SearchRouteEntry['access']): boolean {
		if (access === 'public') return true;
		if (access === 'authenticated') return isAuthenticated;
		return isAuthenticated && userRole?.toLowerCase() === 'admin';
	}

	function isTypingTarget(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;

		return (
			target.isContentEditable ||
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement
		);
	}

	function getTranslatedIfExists(key: string): string | null {
		const translated = $t(key);
		if (!translated || translated === key) return null;
		return translated;
	}

	function getRouteLabel(route: SearchRouteEntry): string {
		if (route.seoTitleKey) {
			const seoTitle = getTranslatedIfExists(route.seoTitleKey);
			if (seoTitle) return seoTitle;
		}

		if (route.titleKey) {
			const title = getTranslatedIfExists(route.titleKey);
			if (title) return title;
		}

		return titleizeRouteFromHref(route.href);
	}

	const groupedRoutes = $derived.by(() => {
		const visibleRoutes = SEARCH_ROUTES.filter((route) => hasAccess(route.access));
		const menuGroups: MenuGroup[] = [];

		for (const group of groupOrder) {
			const heading = $t(groupKeyMap[group]);
			const items = visibleRoutes
				.filter((route) => route.group === group)
				.map((route) => {
					const label = getRouteLabel(route);
					const localizedUrl = localizedHref(route.href);
					const segmentKeywords = route.href.split('/').filter(Boolean);
					const keywords = [...new Set([...(route.keywords ?? []), ...segmentKeywords])];

					return {
						...route,
						id: `${group}:${route.href}`,
						label,
						localizedUrl,
						value: `${heading} ${label} ${route.href}`,
						keywords
					};
				});

			if (items.length > 0) {
				menuGroups.push({
					group,
					heading,
					items
				});
			}
		}

		return menuGroups;
	});

	function runCommand(command: () => unknown): void {
		globalSearch.closeMenu();
		command();
	}

	function openCommandMenu(): void {
		globalSearch.openMenu();
	}

	function handleKeydown(e: KeyboardEvent): void {
		if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || e.key === '/') {
			if (isTypingTarget(e.target)) {
				return;
			}

			e.preventDefault();
			if (globalSearch.open) {
				globalSearch.closeMenu();
			} else {
				openCommandMenu();
			}
		}
	}
</script>

<svelte:document onkeydown={handleKeydown} />

<Dialog.Root open={globalSearch.open} onOpenChange={globalSearch.setOpen}>
	<Dialog.Content
		showCloseButton={false}
		class="rounded-xl border-none bg-clip-padding p-2 pb-11 shadow-2xl ring-4 ring-zinc-200/80 dark:bg-zinc-900 dark:ring-zinc-800"
	>
		<Dialog.Header class="sr-only">
			<Dialog.Title>{$t('search.command.dialog_title')}</Dialog.Title>
			<Dialog.Description>{$t('search.command.dialog_description')}</Dialog.Description>
		</Dialog.Header>
		<Command.Root
			class="rounded-none bg-transparent **:data-[slot=command-input]:!h-9 **:data-[slot=command-input]:py-0 **:data-[slot=command-input-wrapper]:mb-0 **:data-[slot=command-input-wrapper]:!h-9 **:data-[slot=command-input-wrapper]:rounded-md **:data-[slot=command-input-wrapper]:border **:data-[slot=command-input-wrapper]:border-input **:data-[slot=command-input-wrapper]:bg-input/50"
		>
			<Command.Input placeholder={$t('search.command.input_placeholder')} />
			<Command.List class="no-scrollbar min-h-80 scroll-pt-2 scroll-pb-1.5">
				<Command.Empty class="py-12 text-center text-sm text-muted-foreground">
					{$t('search.command.no_results')}
				</Command.Empty>
				{#each groupedRoutes as group (group.group)}
					<Command.Group
						heading={group.heading}
						class="!p-0 [&_[data-command-group-heading]]:scroll-mt-16 [&_[data-command-group-heading]]:!p-3 [&_[data-command-group-heading]]:!pb-1"
					>
						{#each group.items as item (item.id)}
							<CommandMenuItem
								value={item.value}
								keywords={item.keywords}
								onSelect={() => {
									runCommand(() => {
										void goto(resolve(item.localizedUrl));
									});
								}}
							>
								<ArrowRightIcon />
								{item.label}
							</CommandMenuItem>
						{/each}
					</Command.Group>
				{/each}
			</Command.List>
		</Command.Root>
		<div
			class="absolute inset-x-0 bottom-0 z-20 flex h-10 items-center gap-2 rounded-b-xl border-t border-t-zinc-100 bg-zinc-50 px-4 text-xs font-medium text-muted-foreground dark:border-t-zinc-700 dark:bg-zinc-800"
		>
			<div class="flex items-center gap-2">
				<Kbd.Root class="border bg-background"><CornerDownLeftIcon /></Kbd.Root>
				{$t('search.command.footer.go_to_page')}
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
