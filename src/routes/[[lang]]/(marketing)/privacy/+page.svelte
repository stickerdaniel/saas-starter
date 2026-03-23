<script lang="ts">
	import SvelteMarkdown from '@humanspeak/svelte-markdown';
	import ObfuscatedEmail from '$lib/components/obfuscated-email.svelte';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { getTranslate } from '@tolgee/svelte';
	import source from '$lib/content/privacy.md?raw';

	const { t } = getTranslate();
</script>

<SEOHead title={$t('meta.privacy.title')} description={$t('meta.privacy.description')} />

<!-- Legal text is intentionally English-only — the English version is the governed version. -->
<div lang="en" class="mx-auto prose prose-sm max-w-3xl px-6 pt-40 pb-24 lg:px-12 dark:prose-invert">
	<SvelteMarkdown {source} />
	<p>
		For privacy-related questions or to exercise your rights, please contact us at
		<ObfuscatedEmail
			user="daniel"
			domain="sticker"
			tld="name"
			class="underline underline-offset-4"
		/>.
	</p>
</div>
