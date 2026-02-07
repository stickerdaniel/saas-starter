<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { useGlobalSearchContext } from '$lib/components/global-search/context.svelte';
	import * as Empty from '$lib/components/ui/empty/index.js';
	import * as InputGroup from '$lib/components/ui/input-group/index.js';
	import * as Kbd from '$lib/components/ui/kbd/index.js';
	import { getLanguage } from '$lib/i18n/languages';
	import SearchIcon from '@lucide/svelte/icons/search';
	import de from '../../i18n/de.json';
	import en from '../../i18n/en.json';
	import es from '../../i18n/es.json';
	import fr from '../../i18n/fr.json';

	type ErrorPageTranslations = {
		error_page: {
			back_home: string;
			generic_description: string;
			generic_title: string;
			need_help: string;
			not_found_description: string;
			not_found_title: string;
			search_placeholder: string;
		};
	};

	const translationsByLang: Record<string, ErrorPageTranslations> = {
		de,
		en,
		es,
		fr
	};

	const currentLang = $derived(
		getLanguage(page.params.lang ?? page.url.pathname.split('/')[1]).code
	);
	const homeHref = $derived(`/${currentLang}`);
	const isNotFound = $derived(page.status === 404);
	const translations = $derived(translationsByLang[currentLang]);
	const title = $derived(
		isNotFound
			? translations.error_page.not_found_title
			: `${page.status} - ${translations.error_page.generic_title}`
	);
	const description = $derived(
		isNotFound
			? translations.error_page.not_found_description
			: translations.error_page.generic_description
	);

	let globalSearch: ReturnType<typeof useGlobalSearchContext> | null = null;

	try {
		globalSearch = useGlobalSearchContext();
	} catch {
		globalSearch = null;
	}

	function openGlobalSearch(): void {
		globalSearch?.openMenu();
	}

	function handleSearchTriggerKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			openGlobalSearch();
		}
	}
</script>

<main class="grid min-h-[100dvh] w-full place-items-center px-4 py-8">
	<Empty.Root class="w-full max-w-xl bg-background/60">
		<Empty.Header>
			<Empty.Title>{title}</Empty.Title>
			<Empty.Description>{description}</Empty.Description>
		</Empty.Header>
		<Empty.Content>
			<InputGroup.Root class="sm:w-3/4" onclick={openGlobalSearch}>
				<InputGroup.Input
					placeholder={translations.error_page.search_placeholder}
					readonly
					aria-readonly="true"
					tabindex={0}
					onfocus={openGlobalSearch}
					onkeydown={handleSearchTriggerKeydown}
				/>
				<InputGroup.Addon>
					<SearchIcon />
				</InputGroup.Addon>
				<InputGroup.Addon align="inline-end">
					<Kbd.Root class="border">/</Kbd.Root>
				</InputGroup.Addon>
			</InputGroup.Root>
			<Empty.Description>
				{translations.error_page.need_help}
				<a href={resolve(homeHref)} class="text-primary underline-offset-4 hover:underline">
					{translations.error_page.back_home}
				</a>
			</Empty.Description>
		</Empty.Content>
	</Empty.Root>
</main>
