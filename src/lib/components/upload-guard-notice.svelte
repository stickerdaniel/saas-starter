<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';
	import { watch } from 'runed';
	import { toast } from 'svelte-sonner';
	import { activeUploadsContext } from '#lib/hooks/active-uploads.svelte.ts';

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

	// A deploy replaced the app while a file was in flight, so app.html kept the
	// page. Offered until the user takes or dismisses it; reloading mid-upload
	// still gets the browser's leave prompt.
	watch(
		() => activeUploads.heldReloadCount,
		(count) => {
			if (count === 0) return;
			toast.info($t('common.update_available'), {
				id: 'deploy-reload-held',
				duration: Number.POSITIVE_INFINITY,
				closeButton: true,
				action: {
					label: $t('common.reload'),
					// Prevented so the notice stays when the user keeps the page at the
					// browser's leave prompt; a reload that goes through replaces it anyway.
					onClick: (event) => {
						event.preventDefault();
						location.reload();
					}
				}
			});
		}
	);
</script>
