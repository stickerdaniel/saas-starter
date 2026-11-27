<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';
	import { watch } from 'runed';
	import { toast } from 'svelte-sonner';
	import { Button } from '#lib/components/ui/button/index.js';
	import { toasterStatus } from '#lib/components/ui/sonner/toaster-status.svelte.ts';
	import { activeUploadsContext } from '#lib/hooks/active-uploads.svelte.ts';

	// The navigation guard lives in the root layout's script, which runs outside
	// TolgeeProvider and so has no $t.
	const { t } = getTranslate();
	const activeUploads = activeUploadsContext.get();

	// The toaster loads on the first toast. When a deploy removed its chunk while a
	// file is in flight, app.html keeps the page, so these notices also render here
	// until a later toast loads the toaster.
	const fallback = $derived.by(() => {
		if (!toasterStatus.failed) return null;
		if (activeUploads.heldReloadCount > 0) return 'update_available';
		if (activeUploads.blockedCount > 0 && activeUploads.any) return 'upload_in_progress';
		return null;
	});

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

{#if fallback}
	<div
		role="status"
		data-testid="upload-guard-fallback"
		class="fixed right-4 bottom-4 z-100 flex max-w-sm items-center gap-3 rounded-md border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg"
	>
		{#if fallback === 'update_available'}
			<span class="min-w-0">{$t('common.update_available')}</span>
			<Button variant="outline" size="sm" onclick={() => location.reload()}>
				{$t('common.reload')}
			</Button>
		{:else}
			<span class="min-w-0">{$t('common.upload_in_progress')}</span>
		{/if}
	</div>
{/if}
