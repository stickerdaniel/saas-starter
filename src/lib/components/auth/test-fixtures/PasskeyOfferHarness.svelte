<script lang="ts">
	import { Tolgee, TolgeeProvider } from '@tolgee/svelte';
	import { FormatIcu } from '@tolgee/format-icu';
	import en from '../../../../i18n/en.json';
	import PasskeyOffer from '../passkey-offer.svelte';
	import SidebarOfferShell from './SidebarOfferShell.svelte';
	let {
		oncontinue,
		oncreated = () => {},
		sidebar = false
	}: { oncontinue: () => void; oncreated?: () => void; sidebar?: boolean } = $props();
	const tolgee = Tolgee().use(FormatIcu()).init({ language: 'en', staticData: { en } });
	let open = $state(true);
	function close() {
		open = false;
		oncontinue();
	}
</script>

<TolgeeProvider {tolgee}>
	{#if sidebar}
		<SidebarOfferShell />
	{:else if open}
		<PasskeyOffer
			user={{
				userId: 'user-a',
				sessionId: 'session-a',
				name: 'Daniel Example',
				email: 'daniel@example.com'
			}}
			oncontinue={close}
			{oncreated}
		/>
	{/if}
</TolgeeProvider>
