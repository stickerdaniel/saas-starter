<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import PlusIcon from '@tabler/icons-svelte/icons/plus';
	import { T, getTranslate } from '@tolgee/svelte';
	import { toast } from 'svelte-sonner';
	import { addEmailForm } from './data.remote';
	import { emailSchema } from './email-schema';

	const { t } = getTranslate();

	interface Props {
		open?: boolean;
	}

	let { open = $bindable(false) }: Props = $props();

	function handleOpenChange(isOpen: boolean) {
		open = isOpen;
	}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="outline" size="sm" data-testid="add-email-button">
				<PlusIcon class="mr-2 h-4 w-4" />
				<T keyName="admin.settings.add_email" />
			</Button>
		{/snippet}
	</Dialog.Trigger>
	<Dialog.Content class="sm:max-w-[425px]">
		<Dialog.Header>
			<Dialog.Title><T keyName="admin.settings.add_email_dialog_title" /></Dialog.Title>
			<Dialog.Description>
				<T keyName="admin.settings.add_email_dialog_desc" />
			</Dialog.Description>
		</Dialog.Header>
		<form
			{...addEmailForm.preflight(emailSchema).enhance(async ({ submit, form: formEl }) => {
				try {
					await submit();
					// Check if server returned validation errors (e.g., duplicate email)
					const issues = addEmailForm.fields.email.issues() ?? [];
					if (issues.length > 0) {
						// Don't close dialog - let error be displayed
						return;
					}
					formEl.reset();
					toast.success($t('admin.settings.email_added'));
					open = false;
				} catch {
					toast.error($t('admin.settings.email_add_failed'));
				}
			})}
			class="grid gap-4"
		>
			<Field.Group>
				<Field.Field>
					<Field.Label for="email"><T keyName="admin.settings.column_email" /></Field.Label>
					<Input
						{...addEmailForm.fields.email.as('text')}
						inputmode="email"
						autocomplete="email"
						placeholder={$t('admin.settings.add_email_placeholder')}
						data-testid="add-email-input"
					/>
					<Field.Error errors={addEmailForm.fields.email.issues()} data-testid="add-email-error" />
				</Field.Field>
			</Field.Group>
			<Dialog.Footer>
				<Button
					type="button"
					variant="outline"
					onclick={() => (open = false)}
					disabled={!!addEmailForm.pending}
				>
					<T keyName="common.cancel" />
				</Button>
				<Button
					type="submit"
					disabled={!!addEmailForm.pending || !addEmailForm.fields.email.value()?.trim()}
					data-testid="add-email-submit"
				>
					{#if addEmailForm.pending}
						<T keyName="common.adding" />
					{:else}
						<T keyName="admin.settings.add_email" />
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
