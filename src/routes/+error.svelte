<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Empty from '$lib/components/ui/empty/index.js';
	import { getLanguage } from '$lib/i18n/languages';
	import SearchIcon from '@tabler/icons-svelte/icons/search';
	import de from '../i18n/de.json';
	import en from '../i18n/en.json';
	import es from '../i18n/es.json';
	import fr from '../i18n/fr.json';

	type ErrorPageTranslations = {
		error_page: {
			back_home: string;
			generic_description: string;
			generic_title: string;
			not_found_description: string;
			not_found_title: string;
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
</script>

<main class="grid min-h-[100dvh] w-full place-items-center px-4 py-8">
	<Empty.Root class="bg-background/60 w-full max-w-xl">
		<Empty.Header>
			<Empty.Media variant="icon">
				<SearchIcon />
			</Empty.Media>
			<Empty.Title>{title}</Empty.Title>
			<Empty.Description>{description}</Empty.Description>
		</Empty.Header>
		<Empty.Content>
			<Button href={homeHref}>{translations.error_page.back_home}</Button>
		</Empty.Content>
	</Empty.Root>
</main>
