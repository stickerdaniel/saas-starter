<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import TrashIcon from '@tabler/icons-svelte/icons/trash';
	import { T, getTranslate } from '@tolgee/svelte';
	import { getContext } from 'svelte';
	import { confirmDelete } from '$lib/components/ui/confirm-delete-dialog';
	import { toast } from 'svelte-sonner';

	interface Props {
		email: string;
		isAdminUser: boolean;
	}

	let { email, isAdminUser }: Props = $props();

	const { t } = getTranslate();

	// Get the remove handler from context (provided by the table)
	const onRemove = getContext<(email: string) => Promise<void>>('onRemoveEmail');

	function handleRemove() {
		confirmDelete({
			title: $t('admin.settings.delete_email_title'),
			description: $t('admin.settings.delete_email_description', { email }),
			confirm: {
				text: $t('admin.settings.delete_email')
			},
			cancel: {
				text: $t('common.cancel')
			},
			onConfirm: async () => {
				try {
					await onRemove(email);
					toast.success($t('admin.settings.email_removed'));
				} catch (error) {
					console.error('[recipients-actions] Failed to remove email:', error);
					toast.error(
						error instanceof Error ? error.message : $t('admin.settings.preference_update_failed')
					);
					throw error; // Re-throw so confirmDelete knows it failed
				}
			}
		});
	}
</script>

{#if !isAdminUser}
	<Button
		variant="ghost"
		size="icon"
		class="h-8 w-8 text-muted-foreground hover:text-destructive"
		onclick={handleRemove}
		data-testid="delete-email-{email}"
	>
		<TrashIcon class="h-4 w-4" />
		<span class="sr-only"><T keyName="admin.settings.delete_email" /></span>
	</Button>
{:else}
	<!-- Invisible placeholder to maintain consistent row height -->
	<div class="h-8 w-8" aria-hidden="true"></div>
{/if}
