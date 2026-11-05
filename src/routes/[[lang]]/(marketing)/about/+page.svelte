<script lang="ts">
	import LegalMarkdown from '#lib/components/legal-markdown.svelte';
	import SEOHead from '#lib/components/SEOHead.svelte';
	import { aboutMarkdown as source } from '#lib/content/about.js';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();
</script>

<SEOHead title={$t('meta.about.title')} description={$t('meta.about.description')} />

<!-- About content is intentionally English-only, like the legal pages it links to. -->
<div lang="en" class="mx-auto prose prose-sm max-w-3xl px-6 pt-40 pb-24 lg:px-12 dark:prose-invert">
	<LegalMarkdown content={source} />
</div>
