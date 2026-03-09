<script lang="ts">
	import type { Snippet } from 'svelte';
	import { T } from '@tolgee/svelte';
	import { useConvexClient } from 'convex-svelte';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { getResourceByName, getResourceRuntime } from '$lib/admin/registry';
	import { getPeekFields } from '$lib/admin/peek-fields';
	import { resolveFieldValue } from '$lib/admin/field-utils';
	import FieldRenderer from '$lib/admin/fields/field-renderer.svelte';
	import { isFieldVisible, getViewerUser } from '$lib/admin/visibility';
	import { page } from '$app/state';

	type Props = {
		resourceName: string;
		resourceId: string;
		children: Snippet;
	};

	let { resourceName, resourceId, children }: Props = $props();

	const client = useConvexClient();
	const viewer = getViewerUser(page.data.viewer);

	let open = $state(false);
	let hasFetched = $state(false);
	let record = $state<Record<string, unknown> | null>(null);
	let loading = $state(false);

	const resource = $derived(getResourceByName(resourceName));
	const runtime = $derived(getResourceRuntime(resourceName));
	const peekFields = $derived(resource ? getPeekFields(resource) : []);

	function handleOpenChange(isOpen: boolean) {
		open = isOpen;
		if (isOpen && !hasFetched && runtime) {
			hasFetched = true;
			loading = true;
			void fetchRecord();
		}
	}

	async function fetchRecord() {
		if (!runtime) return;
		try {
			const result = await client.query(runtime.getById, { id: resourceId } as never);
			record = result as Record<string, unknown> | null;
		} catch (error) {
			console.error(`[relation-peek] Failed to fetch ${resourceName}/${resourceId}`, error);
			record = null;
		} finally {
			loading = false;
		}
	}
</script>

<Popover.Root {open} onOpenChange={handleOpenChange}>
	<Popover.Trigger openOnHover openDelay={300} closeDelay={150} data-no-row-click="true">
		{#snippet child({ props })}
			<span {...props} onclick={(e: MouseEvent) => e.stopPropagation()}>
				{@render children()}
			</span>
		{/snippet}
	</Popover.Trigger>

	<Popover.Content class="min-w-80 max-w-xl p-0">
		{#if hasFetched}
			{#if loading}
				<div class="divide-y">
					{#each { length: Math.min(peekFields.length, 4) } as _, i (i)}
						<div class="px-4 py-3">
							<Skeleton class="mb-1 h-3 w-20" />
							<Skeleton class="h-4 w-32" />
						</div>
					{/each}
				</div>
			{:else if record && resource}
				{@const visibleFields = peekFields.filter((f) =>
					isFieldVisible(f, { user: viewer, record })
				)}
				{#if visibleFields.length === 0}
					<div class="px-4 py-3 text-sm text-muted-foreground">
						<T keyName="admin.resources.peek.empty" />
					</div>
				{:else}
					<div class="divide-y">
						{#each visibleFields as field (field.attribute)}
							<div class="px-4 py-3">
								<FieldRenderer
									context="preview"
									{field}
									{record}
									value={resolveFieldValue(field, record)}
								/>
							</div>
						{/each}
					</div>
				{/if}
			{:else}
				<div class="px-4 py-3 text-sm text-muted-foreground">
					<T keyName="admin.resources.peek.empty" />
				</div>
			{/if}
		{/if}
	</Popover.Content>
</Popover.Root>
