<script lang="ts">
	import { T } from '@tolgee/svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import FieldRenderer from '$lib/admin/fields/field-renderer.svelte';
	import type { ActionDefinition } from '$lib/admin/types';

	type Props = {
		open: boolean;
		action?: ActionDefinition;
		values: Record<string, unknown>;
		errors?: Record<string, string>;
		relationOptions?: Record<string, Array<{ value: string; label: string }>>;
		onOpenChange: (open: boolean) => void;
		onValueChange: (key: string, value: unknown) => void;
		onConfirm: () => Promise<void>;
		busy?: boolean;
	};

	let {
		open,
		action,
		values,
		errors = {},
		relationOptions = {},
		onOpenChange,
		onValueChange,
		onConfirm,
		busy = false
	}: Props = $props();
</script>

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>
				{#if action}
					<T keyName={action.nameKey} />
				{/if}
			</Dialog.Title>
			{#if action?.confirmTextKey}
				<Dialog.Description>
					<T keyName={action.confirmTextKey} />
				</Dialog.Description>
			{/if}
		</Dialog.Header>

		<div class="space-y-3">
			{#each action?.fields ?? [] as field (field.attribute)}
				<FieldRenderer
					context="form"
					{field}
					record={values}
					value={values[field.attribute]}
					error={errors[field.attribute]}
					testId={`action-field-${field.attribute}`}
					relationOptions={relationOptions[field.attribute] ?? []}
					onChange={(value) => onValueChange(field.attribute, value)}
				/>
			{/each}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => onOpenChange(false)}>
				{#if action?.cancelButtonTextKey}
					<T keyName={action.cancelButtonTextKey} />
				{:else}
					<T keyName="common.cancel" />
				{/if}
			</Button>
			<Button onclick={() => void onConfirm()} disabled={busy}>
				{#if action?.confirmButtonTextKey}
					<T keyName={action.confirmButtonTextKey} />
				{:else}
					<T keyName="common.confirm" />
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
