<script lang="ts">
	import SvelteMarkdown from '@humanspeak/svelte-markdown';
	import ObfuscatedEmail from '$lib/components/obfuscated-email.svelte';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { LEGAL_CONFIG } from '$lib/config/legal';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

	const source = `# Impressum

Angaben gemaess Paragraph 5 DDG.

## Anbieter

${LEGAL_CONFIG.operatorName}

${LEGAL_CONFIG.address}`;
</script>

<SEOHead title={$t('meta.impressum.title')} description={$t('meta.impressum.description')} />

<div class="mx-auto prose prose-sm max-w-3xl px-6 pt-40 pb-24 lg:px-12 dark:prose-invert">
	<SvelteMarkdown {source} />
	<p>
		E-Mail:
		<ObfuscatedEmail
			user={LEGAL_CONFIG.email.user}
			domain={LEGAL_CONFIG.email.domain}
			tld={LEGAL_CONFIG.email.tld}
			class="underline underline-offset-4"
		/>
	</p>
</div>
