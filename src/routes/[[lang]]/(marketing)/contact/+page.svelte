<script lang="ts">
	import { resolve } from '$app/paths';
	import LegalMarkdown from '#lib/components/legal-markdown.svelte';
	import ObfuscatedEmail from '#lib/components/obfuscated-email.svelte';
	import SEOHead from '#lib/components/SEOHead.svelte';
	import { LEGAL_CONFIG } from '#lib/config/legal.js';
	import { contactMarkdown, legalNoticeMarkdown } from '#lib/content/contact.js';
	import { localizedHref } from '#lib/utils/i18n.js';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();
</script>

{#snippet email()}
	<p>
		Email:
		<ObfuscatedEmail
			user={LEGAL_CONFIG.email.user}
			domain={LEGAL_CONFIG.email.domain}
			tld={LEGAL_CONFIG.email.tld}
			class="underline underline-offset-4"
		/>
	</p>
{/snippet}

<SEOHead title={$t('meta.contact.title')} description={$t('meta.contact.description')} />

<!-- Contact content, including the legal notice, is intentionally English-only. -->
<div lang="en" class="mx-auto prose prose-sm max-w-3xl px-6 pt-40 pb-24 lg:px-12 dark:prose-invert">
	<LegalMarkdown content={contactMarkdown} />
	{@render email()}
	<p>
		Support chat:
		<!-- Only the homepage mounts the support widget; `support=open` opens it on load. -->
		<a href={resolve(localizedHref('/?support=open'))}>Open the support chat</a>
	</p>
	<!-- The footer and the `/impressum` redirect link to this id; scroll-mt clears the fixed header. -->
	<section id="legal-notice" class="scroll-mt-32">
		<LegalMarkdown content={legalNoticeMarkdown} />
		{@render email()}
	</section>
</div>
