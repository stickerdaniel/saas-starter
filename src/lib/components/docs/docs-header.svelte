<script lang="ts" module>
	export interface DocsHeaderLink {
		label: string;
		path: string;
		current: boolean;
	}
</script>

<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';
	import { resolve } from '$app/paths';
	import SearchIcon from '@lucide/svelte/icons/search';
	import CommandTrigger from '#lib/components/global-search/command-trigger.svelte';
	import { useGlobalSearchContext } from '#lib/components/global-search/context.svelte.ts';
	import LanguageSwitcher from '#lib/components/LanguageSwitcher.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import LightSwitch from '#lib/components/ui/light-switch/light-switch.svelte';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import { LEGAL_CONFIG } from '#lib/config/legal.js';
	import { getRepositoryUrl } from '#lib/config/site.js';
	import type { DocsNavSection } from '#lib/docs/navigation.js';
	import { docsPath } from '#lib/docs/urls.js';
	import { localizedHref } from '#lib/utils/i18n.js';
	import DocsMobileNav from './docs-mobile-nav.svelte';
	import GithubIcon from '#lib/components/icons/github-icon.svelte';

	let {
		sections,
		currentSlug,
		lang
	}: {
		sections: readonly DocsNavSection[];
		currentSlug: string;
		lang: string;
	} = $props();

	const { t } = getTranslate();
	const globalSearch = useGlobalSearchContext();
	const homePath = $derived(localizedHref('/', lang));
	const links = $derived<DocsHeaderLink[]>([
		{ label: $t('nav.home'), path: homePath, current: false },
		{ label: $t('docs.label'), path: docsPath(lang, ''), current: currentSlug === '' },
		{ label: $t('nav.pricing'), path: localizedHref('/pricing', lang), current: false }
	]);
</script>

<header class="sticky top-(--top-notices-height,0px) z-50 w-full bg-background">
	<div class="flex h-(--docs-header-height) items-center gap-2 px-6">
		<DocsMobileNav {links} {sections} {currentSlug} {lang} />
		<Button
			variant="ghost"
			size="icon-sm"
			class="md:hidden"
			aria-label={$t('search.command.dialog_title')}
			onclick={globalSearch.openMenu}
			onpointerenter={globalSearch.preloadMenu}
			onfocus={globalSearch.preloadMenu}
		>
			<SearchIcon aria-hidden="true" />
		</Button>
		<div class="hidden items-center lg:flex">
			<a
				href={resolve(homePath)}
				class="me-2 inline-flex h-8 items-center pe-2.5 font-semibold tracking-tight"
			>
				{LEGAL_CONFIG.brandName}
			</a>
			<nav class="flex items-center">
				{#each links as link (link.path)}
					<Button
						variant="ghost"
						size="sm"
						href={resolve(link.path)}
						aria-current={link.current ? 'page' : undefined}
					>
						{link.label}
					</Button>
				{/each}
			</nav>
		</div>
		<div class="ms-auto flex items-center gap-2 md:flex-1 md:justify-end">
			<div class="hidden md:flex">
				<CommandTrigger />
			</div>
			<Separator decorative orientation="vertical" class="ms-2 hidden h-4! lg:block" />
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
			<Separator decorative orientation="vertical" class="h-4!" />
			<LightSwitch variant="ghost" />
			<LanguageSwitcher variant="ghost" />
		</div>
	</div>
</header>
