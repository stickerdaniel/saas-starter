<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';
	import { watch } from 'runed';
	import { toast } from 'svelte-sonner';
	import { activeUploadsContext } from '$lib/hooks/active-uploads.svelte.ts';

	// Renders nothing. It exists because the navigation guard lives in the root
	// layout's script, which runs outside TolgeeProvider and so has no $t.
	const { t } = getTranslate();
	const activeUploads = activeUploadsContext.get();

	// Safe to miss: nothing was lost, the upload is still visibly running, and the
	// page has not moved. The user can simply click again once it finishes.
	watch(
		() => activeUploads.blockedCount,
		(count) => {
			if (count === 0) return;
			toast.info($t('common.upload_in_progress'));
		}
	);
</script>
