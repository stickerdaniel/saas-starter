<script lang="ts">
	import { T } from '@tolgee/svelte';
	import { useQuery } from 'convex-svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import type { ResourceDefinition, ResourceRuntime } from '$lib/admin/types';
	import { getPreviewFields } from '$lib/admin/peek-fields';
	import { resolveFieldValue } from '$lib/admin/field-utils';
	import { isFieldVisible, getViewerUser } from '$lib/admin/visibility';
	import FieldRenderer from '$lib/admin/fields/field-renderer.svelte';
	import { page } from '$app/state';

	type Props = {
		open: boolean;
		resourceId: string | null;
		resource: ResourceDefinition<any>;
		runtime: ResourceRuntime;
		prefix: string;
		onClose: () => void;
		onOpenDetail: (id: string) => void;
	};

	let { open, resourceId, resource, runtime, prefix, onClose, onOpenDetail }: Props = $props();

	const viewer = getViewerUser(page.data.viewer);
	const previewFields = $derived(getPreviewFields(resource));

	const detailQuery = $derived(
		resourceId ? useQuery(runtime.getById, { id: resourceId } as never) : null
	);

	const record = $derived(detailQuery?.data as Record<string, unknown> | null | undefined);
	const isLoading = $derived(detailQuery?.isLoading ?? true);
</script>

<Dialog.Root
	{open}
	onOpenChange={(v) => {
		if (!v) onClose();
	}}
>
	<Dialog.Content data-testid={`${prefix}-preview-dialog`}>
		<Dialog.Header>
			<Dialog.Title><T keyName="admin.resources.sections.preview" /></Dialog.Title>
			{#if record}
				<Dialog.Description>{resource.title(record)}</Dialog.Description>
			{:else}
				<Dialog.Description>
					<Skeleton class="h-4 w-40" />
				</Dialog.Description>
			{/if}
		</Dialog.Header>

		<div class="grid gap-4 md:grid-cols-2" data-testid={`${prefix}-preview-content`}>
			{#if isLoading || !record}
				{#each { length: Math.min(previewFields.length, 6) } as _, i (i)}
					<div class="space-y-2">
						<Skeleton class="h-3 w-20" />
						<Skeleton class="h-4 w-32" />
					</div>
				{/each}
			{:else}
				{#each previewFields as field (field.attribute)}
					{#if isFieldVisible(field, { user: viewer, record })}
						<FieldRenderer
							context="preview"
							{field}
							{record}
							value={resolveFieldValue(field, record)}
						/>
					{/if}
				{/each}
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={onClose}>
				<T keyName="common.cancel" />
			</Button>
			<Button
				onclick={() => {
					if (resourceId) {
						onOpenDetail(resourceId);
						onClose();
					}
				}}
				disabled={!resourceId}
				data-testid={`${prefix}-preview-open-detail`}
			>
				<T keyName="admin.resources.actions.view" />
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
