<script lang="ts">
	import { resolve } from '$app/paths';
	import LegalMarkdown from '#lib/components/legal-markdown.svelte';
	import ObfuscatedEmail from '#lib/components/obfuscated-email.svelte';
	import SEOHead from '#lib/components/SEOHead.svelte';
	import { LEGAL_CONFIG } from '#lib/config/legal.js';
	import { contactMarkdown as source } from '#lib/content/contact.js';
	import { localizedHref } from '#lib/utils/i18n.js';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();
</script>

<SEOHead title={$t('meta.contact.title')} description={$t('meta.contact.description')} />

<!-- Contact content is intentionally English-only, like the Impressum. -->
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
	<p>
		Support chat:
		<!-- Only the homepage mounts the support widget; `support=open` opens it on load. -->
		<a href={resolve(localizedHref('/?support=open'))}>Open the support chat</a>
	</p>
</div>
