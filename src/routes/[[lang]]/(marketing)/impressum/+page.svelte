<script lang="ts">
	import LegalMarkdown from '$lib/components/legal-markdown.svelte';
	import ObfuscatedEmail from '$lib/components/obfuscated-email.svelte';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { LEGAL_CONFIG } from '$lib/config/legal';
	import { LEGAL_CONTENT_DATES, formatLegalContentDate } from '$lib/content/legal-metadata';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

	const source = `# Impressum

Last Updated: ${formatLegalContentDate(LEGAL_CONTENT_DATES.impressum)}

---

Information pursuant to Section 5 DDG.

## Provider

${LEGAL_CONFIG.operatorName}

${LEGAL_CONFIG.address}`;
</script>

<SEOHead title={$t('meta.impressum.title')} description={$t('meta.impressum.description')} />

<!-- Impressum content is intentionally English-only. -->
<div lang="en" class="mx-auto prose prose-sm max-w-3xl px-6 pt-40 pb-24 lg:px-12 dark:prose-invert">
	<LegalMarkdown content={source} />
	<p>
		Email:
		<ObfuscatedEmail
			user={LEGAL_CONFIG.email.user}
			domain={LEGAL_CONFIG.email.domain}
			tld={LEGAL_CONFIG.email.tld}
			class="underline underline-offset-4"
		/>
	</p>
</div>
