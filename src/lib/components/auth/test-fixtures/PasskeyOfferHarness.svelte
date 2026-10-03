<script lang="ts">
	import { Tolgee, TolgeeProvider } from '@tolgee/svelte';
	import { FormatIcu } from '@tolgee/format-icu';
	import en from '../../../../i18n/en.json';
	import PasskeyOffer from '../passkey-offer.svelte';
	let { oncontinue }: { oncontinue: () => void } = $props();
	const tolgee = Tolgee().use(FormatIcu()).init({ language: 'en', staticData: { en } });
</script>

<TolgeeProvider {tolgee}>
	<PasskeyOffer
		user={{
			userId: 'user-a',
			sessionId: 'session-a',
			name: 'Daniel Example',
			email: 'daniel@example.com'
		}}
		provider="google"
		{oncontinue}
	/>
</TolgeeProvider>
