<script lang="ts">
	import { untrack } from 'svelte';
	import LazyToaster from '#lib/components/ui/sonner/lazy-toaster.svelte';
	import UploadGuardNotice from '#lib/components/upload-guard-notice.svelte';
	import { activeUploadsContext, type ActiveUploads } from '#lib/hooks/active-uploads.svelte.ts';

	const { uploads }: { uploads: ActiveUploads } = $props();

	activeUploadsContext.set(untrack(() => uploads));
</script>

<LazyToaster />
<UploadGuardNotice />
