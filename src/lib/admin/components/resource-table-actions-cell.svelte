<script lang="ts">
	import EyeIcon from '@lucide/svelte/icons/eye';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import Undo2Icon from '@lucide/svelte/icons/undo-2';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import { T } from '@tolgee/svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	type Props = {
		row: Record<string, unknown>;
		prefix: string;
		canUpdate: boolean;
		canDelete: boolean;
		onView: () => void;
		onEdit: () => void;
		onReplicate: () => void;
		onRestore: () => void;
		onDelete: () => void;
	};

	let {
		row,
		prefix,
		canUpdate,
		canDelete,
		onView,
		onEdit,
		onReplicate,
		onRestore,
		onDelete
	}: Props = $props();
</script>

<div class="flex justify-end gap-1">
	<Button
		variant="ghost"
		size="icon"
		onclick={onView}
		data-testid={`${prefix}-row-view-${row._id}`}
		data-no-row-click="true"
	>
		<EyeIcon class="size-4" />
		<span class="sr-only"><T keyName="admin.resources.actions.view" /></span>
	</Button>
	<Button
		variant="ghost"
		size="icon"
		onclick={onEdit}
		data-testid={`${prefix}-row-edit-${row._id}`}
		data-no-row-click="true"
		disabled={!canUpdate}
	>
		<PencilIcon class="size-4" />
		<span class="sr-only"><T keyName="admin.resources.actions.edit" /></span>
	</Button>
	<Button
		variant="ghost"
		size="icon"
		onclick={onReplicate}
		data-testid={`${prefix}-row-replicate-${row._id}`}
		data-no-row-click="true"
		disabled={!canUpdate}
	>
		<CopyIcon class="size-4" />
		<span class="sr-only"><T keyName="admin.resources.actions.replicate" /></span>
	</Button>
	{#if row.deletedAt}
		<Button
			variant="ghost"
			size="icon"
			onclick={onRestore}
			data-testid={`${prefix}-row-restore-${row._id}`}
			data-no-row-click="true"
			disabled={!canDelete}
		>
			<Undo2Icon class="size-4" />
			<span class="sr-only"><T keyName="admin.resources.actions.restore" /></span>
		</Button>
	{:else}
		<Button
			variant="ghost"
			size="icon"
			onclick={onDelete}
			data-testid={`${prefix}-row-delete-${row._id}`}
			data-no-row-click="true"
			disabled={!canDelete}
		>
			<Trash2Icon class="size-4" />
			<span class="sr-only"><T keyName="admin.resources.actions.delete" /></span>
		</Button>
	{/if}
</div>
