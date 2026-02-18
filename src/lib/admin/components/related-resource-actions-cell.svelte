<script lang="ts">
	import EyeIcon from '@lucide/svelte/icons/eye';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { T } from '@tolgee/svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	type Props = {
		row: Record<string, unknown>;
		prefix: string;
		onView: () => void;
		onEdit: () => void;
		onDelete: () => void;
	};

	let { row, prefix, onView, onEdit, onDelete }: Props = $props();
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
	>
		<PencilIcon class="size-4" />
		<span class="sr-only"><T keyName="admin.resources.actions.edit" /></span>
	</Button>
	<Button
		variant="ghost"
		size="icon"
		onclick={onDelete}
		data-testid={`${prefix}-row-delete-${row._id}`}
		data-no-row-click="true"
	>
		<Trash2Icon class="size-4" />
		<span class="sr-only"><T keyName="admin.resources.actions.delete" /></span>
	</Button>
</div>
