<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { T, getTranslate } from '@tolgee/svelte';
	import { getRemoveEmailContext } from './recipients-context';
	import { confirmDelete } from '$lib/components/ui/confirm-delete-dialog';
	import { toast } from 'svelte-sonner';

	interface Props {
		email: string;
		isAdminUser: boolean;
	}

	let { email, isAdminUser }: Props = $props();

	const { t } = getTranslate();

	// Get the remove handler from context (provided by the table)
	const onRemove = getRemoveEmailContext();

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
				} catch (error) {
					console.error('[recipients-actions] Failed to remove email:', error);
					toast.error($t('admin.settings.preference_update_failed'));
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
