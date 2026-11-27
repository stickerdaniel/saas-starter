<script lang="ts">
	import { page } from '$app/state';
	import * as Breadcrumb from '#lib/components/ui/breadcrumb/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import LanguageSwitcher from '#lib/components/LanguageSwitcher.svelte';
	import LightSwitch from '#lib/components/ui/light-switch/light-switch.svelte';
	import CommandTrigger from '#lib/components/global-search/command-trigger.svelte';
	import GithubIcon from '#lib/components/icons/github-icon.svelte';
	import { buildBreadcrumbs } from './breadcrumbs';
	import { getTranslate } from '@tolgee/svelte';
	import { getRepositoryUrl } from '#lib/config/site.js';

	const { t } = getTranslate();

	interface Props {
		routePrefix: string;
		rootLabel: string;
	}

	let { routePrefix, rootLabel }: Props = $props();

	const breadcrumbs = $derived(
		buildBreadcrumbs(page.url.pathname, routePrefix, rootLabel, page.params.lang, (key) => $t(key))
	);
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
					<Breadcrumb.Item class={index === 0 ? 'hidden md:inline-flex' : ''}>
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
				size="icon-sm"
				href={getRepositoryUrl()}
				target="_blank"
				rel="noopener noreferrer"
				aria-label={$t('aria.github_repository')}
			>
				<GithubIcon />
			</Button>
			<LightSwitch variant="ghost" />
			<LanguageSwitcher variant="ghost" />
		</div>
	</div>
</header>
