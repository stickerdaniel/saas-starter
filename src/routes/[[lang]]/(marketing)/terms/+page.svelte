<script lang="ts">
	import SvelteMarkdown from '@humanspeak/svelte-markdown';
	import ObfuscatedEmail from '$lib/components/obfuscated-email.svelte';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { getTranslate } from '@tolgee/svelte';
	import source from '$lib/content/terms.md?raw';

	const { t } = getTranslate();
</script>

<SEOHead title={$t('meta.terms.title')} description={$t('meta.terms.description')} />

<!-- Legal text is intentionally English-only — the English version is the governed version. -->
<div lang="en" class="mx-auto prose prose-sm max-w-3xl px-6 pt-40 pb-24 lg:px-12 dark:prose-invert">
	<SvelteMarkdown {source} />
	<p>
		To report any violations of these Terms of Service or to pose any questions, please contact us
		at <ObfuscatedEmail
			user="daniel"
			domain="sticker"
			tld="name"
			class="underline underline-offset-4"
		/>.
	</p>
</div>
