<script lang="ts">
	import { FormatSimple, TolgeeCore, TolgeeProvider } from '@tolgee/svelte';
	import en from '../../../../i18n/en.json';
	import DocsMarkdown from '../docs-markdown.svelte';

	let { content }: { content: string } = $props();

	const tolgee = TolgeeCore().use(FormatSimple()).init({ language: 'en', staticData: { en } });
</script>

<TolgeeProvider {tolgee}>
	<DocsMarkdown {content} title="Markdown names" />
</TolgeeProvider>
