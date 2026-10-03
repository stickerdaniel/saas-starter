<script lang="ts">
	import { Tolgee, TolgeeProvider } from '@tolgee/svelte';
	import { FormatIcu } from '@tolgee/format-icu';
	import en from '../../../../i18n/en.json';
	import PasskeyOffer from '../passkey-offer.svelte';
	import SidebarPasskeyOffer from '../sidebar-passkey-offer.svelte';
	let { oncontinue, sidebar = false }: { oncontinue: () => void; sidebar?: boolean } = $props();
	const tolgee = Tolgee().use(FormatIcu()).init({ language: 'en', staticData: { en } });
	const user = {
		userId: 'user-a',
		sessionId: 'session-a',
		name: 'Daniel Example',
		email: 'daniel@example.com'
	};
	let open = $state(true);
	function close() {
		open = false;
		oncontinue();
	}
</script>

<TolgeeProvider {tolgee}>
	{#if open && sidebar}
		<SidebarPasskeyOffer {user} provider="google" oncontinue={close} />
	{:else if open}
		<PasskeyOffer {user} oncontinue={close} />
	{/if}
</TolgeeProvider>
