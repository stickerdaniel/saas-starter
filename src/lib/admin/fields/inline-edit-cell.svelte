<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';
	import { toast } from 'svelte-sonner';
	import { useConvexClient } from 'convex-svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { confirmDelete } from '$lib/components/ui/confirm-delete-dialog';
	import type { FieldDefinition } from '$lib/admin/types';
	import type { ResourceRuntime } from '$lib/admin/runtime';
	import { getValidationFieldErrors } from '$lib/admin/error-utils';

	type Props = {
		field: FieldDefinition<any>;
		record: Record<string, unknown>;
		value: unknown;
		runtime: ResourceRuntime;
		testId?: string;
	};

	let { field, record, value, runtime, testId }: Props = $props();

	const { t } = getTranslate();
	const client = useConvexClient();

	let editing = $state(false);
	let editValue = $state<unknown>(undefined);
	let saving = $state(false);

	$effect(() => {
		if (!editing) {
			editValue = value;
		}
	});

	function normalizeInlineValue(input: unknown) {
		if (field.type === 'number') {
			const parsed = Number(input);
			return Number.isFinite(parsed) ? parsed : 0;
		}
		if (field.type === 'boolean') {
			return Boolean(input);
		}
		return input;
	}

	async function runSave(nextValue: unknown) {
		saving = true;
		try {
			await client.mutation(runtime.update, {
				id: String(record._id),
				values: { [field.attribute]: normalizeInlineValue(nextValue) }
			} as never);
			editing = false;
			toast.success($t('admin.resources.toasts.updated'));
		} catch (error) {
			const fieldErrors = getValidationFieldErrors(error);
			if (fieldErrors?.[field.attribute]) {
				toast.error(fieldErrors[field.attribute]);
			} else {
				const message =
					error instanceof Error ? error.message : $t('admin.resources.toasts.save_error');
				toast.error(message);
			}
			editValue = value;
		} finally {
			saving = false;
		}
	}

	async function save(nextValue: unknown) {
		if (nextValue === value) {
			editing = false;
			return;
		}
		if (field.inlineConfirmation) {
			confirmDelete({
				title: $t('admin.resources.confirm.inline_edit_title'),
				description: $t('admin.resources.confirm.inline_edit_description'),
				confirm: { text: $t('common.save') },
				cancel: { text: $t('common.cancel') },
				onConfirm: async () => {
					await runSave(nextValue);
				}
			});
			return;
		}
		await runSave(nextValue);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			void save(editValue);
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			editing = false;
			editValue = value;
		}
	}
</script>

{#if field.type === 'boolean'}
	<Checkbox
		checked={Boolean(value)}
		disabled={saving}
		onCheckedChange={(checked) => void save(Boolean(checked))}
		data-testid={testId}
		data-no-row-click="true"
	/>
{:else if field.type === 'select' && field.options}
	<Select.Root
		type="single"
		value={String(value ?? '')}
		disabled={saving}
		onValueChange={(next) => void save(next)}
	>
		<Select.Trigger data-testid={testId} data-no-row-click="true" class="h-8 min-w-24">
			{#each field.options as option (option.value)}
				{#if option.value === String(value ?? '')}
					{$t(option.labelKey)}
				{/if}
			{/each}
		</Select.Trigger>
		<Select.Content>
			{#each field.options as option (option.value)}
				<Select.Item value={option.value}>{$t(option.labelKey)}</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
{:else if editing}
	<Input
		type={field.type === 'number' ? 'number' : 'text'}
		value={String(editValue ?? '')}
		disabled={saving}
		oninput={(event) => {
			editValue = (event.currentTarget as HTMLInputElement).value;
		}}
		onkeydown={handleKeydown}
		onblur={() => void save(editValue)}
		data-testid={testId}
		data-no-row-click="true"
		class="h-8"
	/>
{:else}
	<button
		type="button"
		class="w-full cursor-pointer rounded px-1 py-0.5 text-left hover:bg-muted"
		onclick={() => {
			editing = true;
			editValue = value;
		}}
		data-testid={testId}
		data-no-row-click="true"
	>
		{String(value ?? '-')}
	</button>
{/if}
