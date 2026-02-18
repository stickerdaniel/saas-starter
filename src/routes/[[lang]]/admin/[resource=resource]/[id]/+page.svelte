<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { T, getTranslate } from '@tolgee/svelte';
	import { toast } from 'svelte-sonner';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import FieldRenderer from '$lib/admin/fields/field-renderer.svelte';
	import ActionModal from '$lib/admin/components/action-modal.svelte';
	import RelatedResourceTable from '$lib/admin/components/related-resource-table.svelte';
	import { getResourceContext } from '$lib/admin/page-helpers';
	import { resolveFieldGroups } from '$lib/admin/field-groups';
	import type { ActionDefinition } from '$lib/admin/types';
	import {
		getViewerUser,
		isFieldVisible,
		isResourceDeletable,
		isResourceUpdatable
	} from '$lib/admin/visibility';
	import { ConfirmDeleteDialog, confirmDelete } from '$lib/components/ui/confirm-delete-dialog';
	import { executeResourceAction } from '$lib/admin/action-response';

	const { t } = getTranslate();
	const client = useConvexClient();
	const viewer = getViewerUser(page.data.viewer);
	const { resource, runtime, prefix } = getResourceContext(page.params.resource ?? '', viewer);

	const detailQuery = useQuery(runtime.getById, { id: page.params.id } as never);
	const ssrRecord = page.data.record as Record<string, unknown> | undefined;
	const record = $derived((detailQuery.data ?? ssrRecord ?? {}) as Record<string, unknown>);
	const hasData = $derived(!!detailQuery.data || !!ssrRecord);
	const isLoading = $derived(!hasData && detailQuery.isLoading);
	const mode: 'resolved' | 'loading' = $derived(isLoading ? 'loading' : 'resolved');
	const hasError = $derived(!isLoading && (detailQuery.error || !detailQuery.data) && !ssrRecord);
	const canUpdateRecord = $derived.by(() => {
		if (!hasData) return true;
		return isResourceUpdatable(resource, viewer, record);
	});
	const canDeleteRecord = $derived.by(() => {
		if (!hasData) return true;
		return isResourceDeletable(resource, viewer, record);
	});
	const detailFields = $derived.by(() =>
		resource.fields.filter((field) => {
			if (field.showOnDetail === false) return false;
			return isFieldVisible(field, { user: viewer, record: record as any });
		})
	);
	const previewFields = $derived.by(() =>
		resource.fields
			.filter((field) => {
				if (field.showOnIndex === false) return false;
				return isFieldVisible(field, { user: viewer, record: record as any });
			})
			.slice(0, 3)
	);
	const detailGroups = $derived(
		resolveFieldGroups({
			resource,
			context: 'detail',
			fields: detailFields
		})
	);
	const previewGroups = $derived(
		resolveFieldGroups({
			resource,
			context: 'preview',
			fields: previewFields
		})
	);
	let activeDetailGroup = $state('');
	let activePreviewGroup = $state('');

	$effect(() => {
		const first = detailGroups[0]?.key ?? '';
		if (!activeDetailGroup || !detailGroups.some((group) => group.key === activeDetailGroup)) {
			activeDetailGroup = first;
		}
	});

	$effect(() => {
		const first = previewGroups[0]?.key ?? '';
		if (!activePreviewGroup || !previewGroups.some((group) => group.key === activePreviewGroup)) {
			activePreviewGroup = first;
		}
	});
	const detailActions = $derived.by(() =>
		(resource.actions ?? []).filter((action) => {
			if (action.showOnDetail === false) return false;
			if (!action.canRun) return true;
			if (!viewer || !hasData) return false;
			return action.canRun(viewer, record);
		})
	);

	let actionOpen = $state(false);
	let actionBusy = $state(false);
	let activeAction = $state<ActionDefinition | undefined>(undefined);
	let actionValues = $state<Record<string, unknown>>({});
	let relationOptions = $state<Record<string, Array<{ value: string; label: string }>>>({});
	let relationOptionsLoadError = $state(false);

	async function executeAction(action: ActionDefinition, values: Record<string, unknown>) {
		return executeResourceAction({
			client,
			runtime,
			action: action.key,
			ids: [String(page.params.id)],
			values,
			navigateTo: async (url) => {
				await goto(resolve(url));
			},
			t: $t
		});
	}

	async function openAction(action: ActionDefinition) {
		if (action.withoutConfirmation && (action.fields?.length ?? 0) === 0) {
			actionBusy = true;
			try {
				await executeAction(action, {});
			} catch (error) {
				const message =
					error instanceof Error ? error.message : $t('admin.resources.toasts.action_error');
				toast.error(message);
			} finally {
				actionBusy = false;
			}
			return;
		}

		activeAction = action;
		actionValues = {};
		relationOptions = {};
		relationOptionsLoadError = false;
		actionOpen = true;
		if (!action.fields || !runtime.listRelationOptions) return;
		for (const field of action.fields) {
			const relationQuery = runtime.listRelationOptions[field.attribute];
			if (!relationQuery) continue;
			try {
				const options = await client.query(relationQuery, {} as never);
				relationOptions[field.attribute] = (options as Array<{ value: string; label: string }>).map(
					(option) => ({
						value: String(option.value),
						label: String(option.label)
					})
				);
			} catch (error) {
				relationOptionsLoadError = true;
				console.error(
					`[admin:${resource.name}] Failed to load relation options for action field "${field.attribute}"`,
					error
				);
			}
		}
	}

	async function runAction() {
		if (!activeAction) return;
		actionBusy = true;
		try {
			const response = await executeAction(activeAction, actionValues);
			if (response.type !== 'danger') {
				actionOpen = false;
			}
		} catch (error) {
			const message =
				error instanceof Error ? error.message : $t('admin.resources.toasts.action_error');
			toast.error(message);
		} finally {
			actionBusy = false;
		}
	}

	async function handleDelete() {
		if (!canDeleteRecord) return;
		try {
			await client.mutation(runtime.delete, { id: page.params.id } as never);
			toast.success($t('admin.resources.toasts.deleted'));
			await goto(resolve(`/${page.params.lang}/admin/${resource.name}`));
		} catch (error) {
			console.error(`[admin:${resource.name}] delete failed`, error);
			toast.error($t('admin.resources.toasts.action_error'));
		}
	}

	function confirmDeleteRecord() {
		confirmDelete({
			title: $t('admin.resources.actions.delete'),
			description: $t('admin.resources.confirm.delete_description'),
			confirm: {
				text: $t('admin.resources.actions.delete')
			},
			cancel: {
				text: $t('common.cancel')
			},
			onConfirm: async () => {
				await handleDelete();
			}
		});
	}

	async function handleRestore() {
		if (!canDeleteRecord) return;
		try {
			await client.mutation(runtime.restore, { id: page.params.id } as never);
			toast.success($t('admin.resources.toasts.restored'));
		} catch (error) {
			console.error(`[admin:${resource.name}] restore failed`, error);
			toast.error($t('admin.resources.toasts.action_error'));
		}
	}

	async function handleForceDelete() {
		if (!canDeleteRecord) return;
		try {
			await client.mutation(runtime.forceDelete, { id: page.params.id } as never);
			toast.success($t('admin.resources.toasts.force_deleted'));
			await goto(resolve(`/${page.params.lang}/admin/${resource.name}`));
		} catch (error) {
			console.error(`[admin:${resource.name}] force delete failed`, error);
			toast.error($t('admin.resources.toasts.action_error'));
		}
	}

	function confirmForceDeleteRecord() {
		confirmDelete({
			title: $t('admin.resources.actions.force_delete'),
			description: $t('admin.resources.confirm.force_delete_description'),
			confirm: {
				text: $t('admin.resources.actions.force_delete')
			},
			cancel: {
				text: $t('common.cancel')
			},
			onConfirm: async () => {
				await handleForceDelete();
			}
		});
	}

	async function handleReplicate() {
		if (!canUpdateRecord) return;
		try {
			await client.mutation(runtime.replicate, { id: page.params.id } as never);
			toast.success($t('admin.resources.toasts.replicated'));
		} catch (error) {
			console.error(`[admin:${resource.name}] replicate failed`, error);
			toast.error($t('admin.resources.toasts.action_error'));
		}
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
	{#if hasError}
		<div
			class="flex flex-col items-center gap-4 rounded-lg border p-8 text-center"
			data-testid={`${prefix}-detail-error`}
		>
			<p class="text-sm text-muted-foreground"><T keyName="admin.resources.load_error" /></p>
			<div class="flex gap-2">
				<Button
					variant="outline"
					size="sm"
					onclick={() => goto(resolve(`/${page.params.lang}/admin/${resource.name}`))}
				>
					<ArrowLeftIcon class="mr-2 size-4" />
					<T keyName="aria.go_back" />
				</Button>
				<Button variant="outline" size="sm" onclick={() => location.reload()}>
					<RefreshCwIcon class="mr-2 size-4" />
					<T keyName="common.retry" />
				</Button>
			</div>
		</div>
	{:else}
		<div class="flex flex-wrap items-center justify-between gap-4">
			<div>
				<h1 class="text-2xl font-bold">{resource.title(record as never)}</h1>
				{#if resource.subtitle}
					<p class="text-sm text-muted-foreground">
						{resource.subtitle(record as never)}
					</p>
				{/if}
			</div>
			<div class="flex flex-wrap items-center gap-2">
				{#if canUpdateRecord}
					<Button
						variant="outline"
						disabled={isLoading}
						onclick={() =>
							goto(resolve(`/${page.params.lang}/admin/${resource.name}/${page.params.id}/edit`))}
						data-testid={`${prefix}-detail-edit`}
					>
						<T keyName="admin.resources.actions.edit" />
					</Button>
					<Button
						variant="outline"
						disabled={isLoading}
						onclick={() => void handleReplicate()}
						data-testid={`${prefix}-detail-replicate`}
					>
						<T keyName="admin.resources.actions.replicate" />
					</Button>
				{/if}
				{#if canDeleteRecord}
					{#if hasData && record.deletedAt}
						<Button
							variant="outline"
							onclick={() => void handleRestore()}
							data-testid={`${prefix}-detail-restore`}
						>
							<T keyName="admin.resources.actions.restore" />
						</Button>
						<Button
							variant="destructive"
							onclick={confirmForceDeleteRecord}
							data-testid={`${prefix}-detail-force-delete`}
						>
							<T keyName="admin.resources.actions.force_delete" />
						</Button>
					{:else}
						<Button
							variant="destructive"
							disabled={isLoading}
							onclick={confirmDeleteRecord}
							data-testid={`${prefix}-detail-delete`}
						>
							<T keyName="admin.resources.actions.delete" />
						</Button>
					{/if}
				{/if}
			</div>
		</div>

		{#if detailActions.length > 0}
			<div class="flex flex-wrap gap-2">
				{#each detailActions as action (action.key)}
					<Button
						variant="outline"
						onclick={() => void openAction(action)}
						data-testid={`${prefix}-detail-action-${action.key}`}
					>
						{#if action.icon}
							{@const ActionIcon = action.icon}
							<ActionIcon class="mr-2 size-4" />
						{/if}
						<T keyName={action.nameKey} />
					</Button>
				{/each}
			</div>
		{/if}

		<Card>
			<CardHeader>
				<CardTitle><T keyName="admin.resources.sections.preview" /></CardTitle>
			</CardHeader>
			<CardContent>
				{#if previewGroups.length > 1}
					<Tabs.Root
						value={activePreviewGroup}
						onValueChange={(next) => (activePreviewGroup = next)}
					>
						<Tabs.List data-testid={`${prefix}-preview-tabs`}>
							{#each previewGroups as group (group.key)}
								<Tabs.Trigger value={group.key} data-testid={`${prefix}-preview-tab-${group.key}`}>
									<T keyName={group.labelKey} />
								</Tabs.Trigger>
							{/each}
						</Tabs.List>
						{#each previewGroups as group (group.key)}
							<Tabs.Content value={group.key}>
								<div class="grid gap-4 md:grid-cols-3">
									{#each group.fields as field (field.attribute)}
										<FieldRenderer
											context="preview"
											{field}
											{mode}
											{record}
											value={field.resolveUsing
												? field.resolveUsing(record)
												: record[field.attribute]}
										/>
									{/each}
								</div>
							</Tabs.Content>
						{/each}
					</Tabs.Root>
				{:else}
					<div class="grid gap-4 md:grid-cols-3">
						{#each previewFields as field (field.attribute)}
							<FieldRenderer
								context="preview"
								{field}
								{mode}
								{record}
								value={field.resolveUsing ? field.resolveUsing(record) : record[field.attribute]}
							/>
						{/each}
					</div>
				{/if}
			</CardContent>
		</Card>

		<Card>
			<CardHeader>
				<CardTitle><T keyName="admin.resources.sections.details" /></CardTitle>
			</CardHeader>
			<CardContent>
				{#if detailGroups.length > 1}
					<Tabs.Root value={activeDetailGroup} onValueChange={(next) => (activeDetailGroup = next)}>
						<Tabs.List data-testid={`${prefix}-detail-tabs`}>
							{#each detailGroups as group (group.key)}
								<Tabs.Trigger value={group.key} data-testid={`${prefix}-detail-tab-${group.key}`}>
									<T keyName={group.labelKey} />
								</Tabs.Trigger>
							{/each}
						</Tabs.List>
						{#each detailGroups as group (group.key)}
							<Tabs.Content value={group.key}>
								<div class="grid gap-4 md:grid-cols-2">
									{#each group.fields as field (field.attribute)}
										{#if field.type === 'hasMany' && field.relation}
											<RelatedResourceTable
												{field}
												{record}
												lang={page.params.lang ?? 'en'}
												{prefix}
											/>
										{:else}
											<FieldRenderer
												context="detail"
												{field}
												{mode}
												{record}
												value={field.resolveUsing
													? field.resolveUsing(record)
													: record[field.attribute]}
											/>
										{/if}
									{/each}
								</div>
							</Tabs.Content>
						{/each}
					</Tabs.Root>
				{:else}
					<div class="grid gap-4 md:grid-cols-2">
						{#each detailFields as field (field.attribute)}
							{#if field.type === 'hasMany' && field.relation}
								<RelatedResourceTable {field} {record} lang={page.params.lang ?? 'en'} {prefix} />
							{:else}
								<FieldRenderer
									context="detail"
									{field}
									{mode}
									{record}
									value={field.resolveUsing ? field.resolveUsing(record) : record[field.attribute]}
								/>
							{/if}
						{/each}
					</div>
				{/if}
			</CardContent>
		</Card>
	{/if}
</div>

<ActionModal
	open={actionOpen}
	action={activeAction}
	values={actionValues}
	{relationOptions}
	{relationOptionsLoadError}
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

<ConfirmDeleteDialog />
