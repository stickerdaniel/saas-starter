<script lang="ts">
	import { Tolgee, TolgeeProvider } from '@tolgee/svelte';
	import { FormatIcu } from '@tolgee/format-icu';
	import en from '../../../../i18n/en.json';
	import { resolve } from '$app/paths';
	import { localizedHref } from '$lib/utils/i18n';
	import AuthPanel from '../auth-panel.svelte';
	let {
		variant,
		transition = false
	}: { variant: 'legal' | 'footer' | 'bare'; transition?: boolean } = $props();
	const tolgee = Tolgee().use(FormatIcu()).init({ language: 'en', staticData: { en } });
	let termsLink = $state<HTMLAnchorElement | null>(null);
	// Read back by the test, the way the sign-in form reads the bound element.
	export function boundTermsLink() {
		return termsLink;
	}
</script>

<TolgeeProvider {tolgee}>
	{#if variant === 'legal'}
		<AuthPanel {transition} legal bind:termsLink>
			<h1>Page content</h1>
		</AuthPanel>
	{:else if variant === 'footer'}
		<AuthPanel {transition}>
			<h1>Page content</h1>
			{#snippet footer()}
				Page helper text <a href={resolve(localizedHref('/app/settings?tab=security'))}>Settings</a>
			{/snippet}
		</AuthPanel>
	{:else}
		<AuthPanel {transition}>
			<h1>Page content</h1>
		</AuthPanel>
	{/if}
</TolgeeProvider>
