<script lang="ts">
	import { T } from '@tolgee/svelte';
	import { resolve } from '$app/paths';
	import { localizedHref } from '#lib/utils/i18n.js';
	import type { PasskeyNudgeUser } from '#lib/utils/passkey-nudge.js';
	import AuthPanel from './auth-panel.svelte';
	import PasskeyOffer from './passkey-offer.svelte';

	/**
	 * The passkey offer as a whole auth card, shown where a sign-in finishes. Swap it in with
	 * morphAuthCard so the card resizes instead of jumping.
	 */
	let {
		user,
		oncontinue,
		oncreated
	}: { user: PasskeyNudgeUser; oncontinue: () => void; oncreated: () => void } = $props();
</script>

<AuthPanel transition>
	<PasskeyOffer {user} {oncontinue} {oncreated} />
	{#snippet footer()}
		<T keyName="auth.passkey_nudge.about_description" />
		<T keyName="auth.passkey_nudge.manage_before" />
		<a
			href={resolve(localizedHref('/app/settings?tab=security'))}
			class="underline underline-offset-4"><T keyName="auth.passkey_nudge.manage_link" /></a
		><T keyName="auth.passkey_nudge.manage_after" />
	{/snippet}
</AuthPanel>
