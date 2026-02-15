<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { T, getTranslate } from '@tolgee/svelte';
	import { toast } from 'svelte-sonner';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card/index.js';
	import FieldRenderer from '$lib/admin/fields/field-renderer.svelte';
	import ActionModal from '$lib/admin/components/action-modal.svelte';
	import { getResourceContext } from '$lib/admin/page-helpers';
	import type { ActionDefinition } from '$lib/admin/types';

	const { t } = getTranslate();
	const client = useConvexClient();
	const { resource, runtime, prefix } = getResourceContext(page.params.resource ?? '');

	const detailQuery = useQuery(runtime.getById, { id: page.params.id } as never);
	const detailFields = resource.fields.filter((field) => field.showOnDetail !== false);
	const previewFields = resource.fields.filter((field) => field.showOnIndex !== false).slice(0, 3);
	const detailActions = (resource.actions ?? []).filter((action) => action.showOnDetail !== false);

	let actionOpen = $state(false);
	let actionBusy = $state(false);
	let activeAction = $state<ActionDefinition | undefined>(undefined);
	let actionValues = $state<Record<string, unknown>>({});
	let relationOptions = $state<Record<string, Array<{ value: string; label: string }>>>({});

	async function openAction(action: ActionDefinition) {
		activeAction = action;
		actionValues = {};
		relationOptions = {};
		actionOpen = true;
		if (!action.fields || !runtime.listRelationOptions) return;
		for (const field of action.fields) {
			const relationQuery = runtime.listRelationOptions[field.attribute];
			if (!relationQuery) continue;
			const options = await client.query(relationQuery, {} as never);
			relationOptions[field.attribute] = (options as Array<{ value: string; label: string }>).map(
				(option) => ({
					value: String(option.value),
					label: String(option.label)
				})
			);
		}
	}

	async function runAction() {
		if (!activeAction) return;
		actionBusy = true;
		try {
			const response = await client.mutation(runtime.runAction, {
				action: activeAction.key,
				ids: [page.params.id],
				values: actionValues
			} as never);

			if (response.type === 'danger') {
				toast.error(response.text);
			} else {
				const responseText = 'text' in response ? response.text : undefined;
				toast.success(responseText ?? $t('admin.resources.toasts.action_success'));
			}
			actionOpen = false;
		} catch (error) {
			const message =
				error instanceof Error ? error.message : $t('admin.resources.toasts.action_error');
			toast.error(message);
		} finally {
			actionBusy = false;
		}
	}

	async function handleDelete() {
		await client.mutation(runtime.delete, { id: page.params.id } as never);
		toast.success($t('admin.resources.toasts.deleted'));
		await goto(resolve(`/${page.params.lang}/admin/${resource.name}`));
	}

	async function handleRestore() {
		await client.mutation(runtime.restore, { id: page.params.id } as never);
		toast.success($t('admin.resources.toasts.restored'));
	}

	async function handleForceDelete() {
		await client.mutation(runtime.forceDelete, { id: page.params.id } as never);
		toast.success($t('admin.resources.toasts.force_deleted'));
		await goto(resolve(`/${page.params.lang}/admin/${resource.name}`));
	}

	async function handleReplicate() {
		await client.mutation(runtime.replicate, { id: page.params.id } as never);
		toast.success($t('admin.resources.toasts.replicated'));
	}
</script>

<SEOHead
	title={$t('meta.admin.resource_detail.title', {
		resource: $t(resource.navTitleKey)
	})}
	description={$t('meta.admin.resource_detail.description', {
		resource: $t(resource.navTitleKey)
	})}
/>

<div
	class="flex flex-col gap-6 px-4 lg:px-6 xl:px-8 2xl:px-16"
	data-testid={`${prefix}-detail-page`}
>
	{#if detailQuery.isLoading || !detailQuery.data}
		<div class="rounded-lg border p-4" data-testid={`${prefix}-detail-loading`}>
			<T keyName="admin.resources.loading" />
		</div>
	{:else}
		<div class="flex flex-wrap items-center justify-between gap-4">
			<div>
				<h1 class="text-2xl font-bold">{resource.title(detailQuery.data as never)}</h1>
				{#if resource.subtitle}
					<p class="text-sm text-muted-foreground">
						{resource.subtitle(detailQuery.data as never)}
					</p>
				{/if}
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<Button
					variant="outline"
					onclick={() =>
						goto(resolve(`/${page.params.lang}/admin/${resource.name}/${page.params.id}/edit`))}
					data-testid={`${prefix}-detail-edit`}
				>
					<T keyName="admin.resources.actions.edit" />
				</Button>
				<Button
					variant="outline"
					onclick={() => void handleReplicate()}
					data-testid={`${prefix}-detail-replicate`}
				>
					<T keyName="admin.resources.actions.replicate" />
				</Button>
				{#if detailQuery.data.deletedAt}
					<Button
						variant="outline"
						onclick={() => void handleRestore()}
						data-testid={`${prefix}-detail-restore`}
					>
						<T keyName="admin.resources.actions.restore" />
					</Button>
					<Button
						variant="destructive"
						onclick={() => void handleForceDelete()}
						data-testid={`${prefix}-detail-force-delete`}
					>
						<T keyName="admin.resources.actions.force_delete" />
					</Button>
				{:else}
					<Button
						variant="destructive"
						onclick={() => void handleDelete()}
						data-testid={`${prefix}-detail-delete`}
					>
						<T keyName="admin.resources.actions.delete" />
					</Button>
				{/if}
			</div>
		</div>

		<div class="flex flex-wrap gap-2">
			{#each detailActions as action (action.key)}
				<Button
					variant="outline"
					onclick={() => void openAction(action)}
					data-testid={`${prefix}-detail-action-${action.key}`}
				>
					<T keyName={action.nameKey} />
				</Button>
			{/each}
		</div>

		<Card>
			<CardHeader>
				<CardTitle><T keyName="admin.resources.sections.preview" /></CardTitle>
			</CardHeader>
			<CardContent>
				<div class="grid gap-4 md:grid-cols-3">
					{#each previewFields as field (field.attribute)}
						<FieldRenderer
							context="preview"
							{field}
							record={detailQuery.data}
							value={field.resolveUsing
								? field.resolveUsing(detailQuery.data)
								: detailQuery.data[field.attribute]}
						/>
					{/each}
				</div>
			</CardContent>
		</Card>

		<Card>
			<CardHeader>
				<CardTitle><T keyName="admin.resources.sections.details" /></CardTitle>
			</CardHeader>
			<CardContent>
				<div class="grid gap-4 md:grid-cols-2">
					{#each detailFields as field (field.attribute)}
						<FieldRenderer
							context="detail"
							{field}
							record={detailQuery.data}
							value={field.resolveUsing
								? field.resolveUsing(detailQuery.data)
								: detailQuery.data[field.attribute]}
						/>
					{/each}
				</div>
			</CardContent>
		</Card>
	{/if}
</div>

<ActionModal
	open={actionOpen}
	action={activeAction}
	values={actionValues}
	{relationOptions}
	busy={actionBusy}
	onOpenChange={(open) => {
		actionOpen = open;
	}}
	onValueChange={(key, value) => {
		actionValues = {
			...actionValues,
			[key]: value
		};
	}}
	onConfirm={runAction}
/>
