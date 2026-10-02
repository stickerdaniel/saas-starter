<script lang="ts">
	import { Tolgee, TolgeeProvider } from '@tolgee/svelte';
	import { FormatIcu } from '@tolgee/format-icu';
	import { Toaster } from 'svelte-sonner';
	import en from '../../../i18n/en.json';
	import { activeUploadsContext, type ActiveUploads } from '$lib/hooks/active-uploads.svelte.ts';
	import UploadGuardNotice from '../upload-guard-notice.svelte';

	let { uploads }: { uploads: ActiveUploads } = $props();
	// The registry is fixed for the life of the harness, as in the root layout.
	// svelte-ignore state_referenced_locally
	activeUploadsContext.set(uploads);
	const tolgee = Tolgee().use(FormatIcu()).init({ language: 'en', staticData: { en } });
	let noticeMounted = $state(true);

	export function unmountNotice() {
		noticeMounted = false;
	}
</script>

<Toaster />
<TolgeeProvider {tolgee}>
	{#if noticeMounted}
		<UploadGuardNotice />
	{/if}
</TolgeeProvider>
