<script lang="ts">
	import { Tolgee, TolgeeProvider } from '@tolgee/svelte';
	import { FormatIcu } from '@tolgee/format-icu';
	import en from '../../../../../i18n/en.json';
	import { activeUploadsContext, type ActiveUploads } from '$lib/hooks/active-uploads.svelte.ts';
	import AccountSettings from '../account-settings.svelte';

	let { uploads }: { uploads: ActiveUploads } = $props();
	// The registry is fixed for the life of the harness, as in the root layout.
	// svelte-ignore state_referenced_locally
	activeUploadsContext.set(uploads);
	const tolgee = Tolgee().use(FormatIcu()).init({ language: 'en', staticData: { en } });
</script>

<TolgeeProvider {tolgee}>
	<AccountSettings user={{ name: 'Daniel Example', email: 'daniel@example.test', image: null }} />
</TolgeeProvider>
