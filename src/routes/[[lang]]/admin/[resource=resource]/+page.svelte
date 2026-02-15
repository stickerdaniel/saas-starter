<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { T, getTranslate } from '@tolgee/svelte';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { toast } from 'svelte-sonner';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import Undo2Icon from '@lucide/svelte/icons/undo-2';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import ConvexCursorTableShell from '$lib/components/tables/convex-cursor-table-shell.svelte';
	import { createConvexCursorTable } from '$lib/tables/convex/create-convex-cursor-table.svelte';
	import type { CursorListResult } from '$lib/tables/convex/contract';
	import {
		getResourceContext,
		getPageSizeOptions,
		createResourceUrlSchema
	} from '$lib/admin/page-helpers';
	import FieldRenderer from '$lib/admin/fields/field-renderer.svelte';
	import FilterPanel from '$lib/admin/components/filter-panel.svelte';
	import ActionModal from '$lib/admin/components/action-modal.svelte';
	import MetricsCards from '$lib/admin/components/metrics-cards.svelte';
	import type { ActionDefinition } from '$lib/admin/types';

	const { t } = getTranslate();
	const client = useConvexClient();

	const { resource, runtime, prefix } = getResourceContext(page.params.resource ?? '');
	const ResourceIcon = resource.icon;

	const defaultFilters = {
		lens: 'all',
		trashed: 'without',
		...Object.fromEntries(
			(resource.filters ?? []).map((filter) => [filter.urlKey, filter.defaultValue])
		)
	} as Record<string, string>;

	const pageSizeOptions = getPageSizeOptions(resource.perPageOptions);
	const pageSizeNumbers = pageSizeOptions.map((option) => Number(option));
	const defaultPageSize = pageSizeOptions[0];

	const urlSchema = createResourceUrlSchema({
		filters: (resource.filters ?? []).map((filter) => ({
			urlKey: filter.urlKey,
			defaultValue: filter.defaultValue
		})),
		pageSizeOptions,
		defaultPageSize
	});

	const resourceTable = createConvexCursorTable<
		Record<string, unknown>,
		string,
		string,
		typeof runtime.list,
		typeof runtime.count,
		any
	>({
		listQuery: runtime.list,
		countQuery: runtime.count,
		urlSchema,
		defaultFilters,
		pageSizeOptions,
		defaultPageSize,
		sortFields: (resource.sortFields?.length ? resource.sortFields : ['createdAt']) as [
			string,
			...string[]
		],
		buildListArgs: ({ cursor, pageSize, search, sortBy, filters, urlState }) => ({
			cursor: cursor ?? undefined,
			numItems: pageSize,
			search,
			sortBy,
			filters,
			lens: urlState.lens === 'all' ? undefined : String(urlState.lens),
			trashed: (urlState.trashed as 'without' | 'with' | 'only' | undefined) ?? 'without'
		}),
		buildCountArgs: ({ search, filters, urlState }) => ({
			search,
			filters,
			lens: urlState.lens === 'all' ? undefined : String(urlState.lens),
			trashed: (urlState.trashed as 'without' | 'with' | 'only' | undefined) ?? 'without'
		}),
		resolveLastPage: async ({ pageSize, search, sortBy, filters, urlState }) => {
			const result = await client.query(runtime.resolveLastPage, {
				numItems: pageSize,
				search,
				sortBy,
				filters,
				lens: urlState.lens === 'all' ? undefined : String(urlState.lens),
				trashed: (urlState.trashed as 'without' | 'with' | 'only' | undefined) ?? 'without'
			});
			return {
				page: result.page,
				cursor: result.cursor
			};
		},
		toListResult: (result) => result as CursorListResult<Record<string, unknown>>,
		toCount: (result) => result as number
	});

	const metricsQuery = useQuery(runtime.getMetrics, {});

	const indexFields = $derived(resource.fields.filter((field) => field.showOnIndex !== false));
	const rows = $derived(resourceTable.rows);
	const tableParams = $derived(resourceTable.currentUrlState);
	const activeLens = $derived(String(tableParams.lens ?? 'all'));
	const activeTrashed = $derived(String(tableParams.trashed ?? 'without'));

	let selectedRows = $state<Record<string, boolean>>({});
	const selectedIds = $derived(
		Object.entries(selectedRows)
			.filter(([, selected]) => selected)
			.map(([id]) => id)
	);

	const hasAnyFilters = $derived.by(() => {
		for (const filter of resource.filters ?? []) {
			if ((resourceTable.filters[filter.urlKey] ?? filter.defaultValue) !== filter.defaultValue) {
				return true;
			}
		}
		if ((resourceTable.filters.lens ?? 'all') !== 'all') return true;
		if ((resourceTable.filters.trashed ?? 'without') !== 'without') return true;
		return false;
	});

	let actionOpen = $state(false);
	let actionBusy = $state(false);
	let activeAction = $state<ActionDefinition | undefined>(undefined);
	let actionValues = $state<Record<string, unknown>>({});
	let relationOptions = $state<Record<string, Array<{ value: string; label: string }>>>({});

	const availableActions = $derived(
		(resource.actions ?? []).filter((action) => action.showOnIndex !== false)
	);

	function isSelected(id: string) {
		return Boolean(selectedRows[id]);
	}

	function toggleRow(id: string, next: boolean) {
		selectedRows = {
			...selectedRows,
			[id]: next
		};
	}

	function toggleAllRows(next: boolean) {
		if (!next) {
			selectedRows = {};
			return;
		}
		const nextState: Record<string, boolean> = {};
		for (const row of rows) {
			nextState[String(row._id)] = true;
		}
		selectedRows = nextState;
	}

	function setFilter(key: string, value: string) {
		resourceTable.setFilter(key, value);
	}

	function clearFilters() {
		resourceTable.setFilter('lens', 'all');
		resourceTable.setFilter('trashed', 'without');
		for (const filter of resource.filters ?? []) {
			resourceTable.setFilter(filter.urlKey, filter.defaultValue);
		}
	}

	function setLens(value: string) {
		resourceTable.setFilter('lens', value);
	}

	function setTrashed(value: string) {
		resourceTable.setFilter('trashed', value);
	}

	function handleSort(field: string) {
		const currentSort = resourceTable.sortBy;
		if (!currentSort || currentSort.field !== field) {
			resourceTable.setSort({ field, direction: 'asc' });
			return;
		}
		if (currentSort.direction === 'asc') {
			resourceTable.setSort({ field, direction: 'desc' });
			return;
		}
		resourceTable.setSort(undefined);
	}

	async function openAction(action: ActionDefinition) {
		activeAction = action;
		actionValues = {};
		relationOptions = {};
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
				console.error('Failed to load action relation options', error);
			}
		}
	}

	async function runActiveAction() {
		if (!activeAction) return;
		actionBusy = true;
		try {
			const response = await client.mutation(runtime.runAction, {
				action: activeAction.key,
				ids: selectedIds as any,
				values: actionValues
			});

			if (response.type === 'danger') {
				toast.error(response.text);
			} else {
				const responseText = 'text' in response ? response.text : undefined;
				toast.success(responseText ?? $t('admin.resources.toasts.action_success'));
			}
			actionOpen = false;
			selectedRows = {};
		} catch (error) {
			const message =
				error instanceof Error ? error.message : $t('admin.resources.toasts.action_error');
			toast.error(message);
		} finally {
			actionBusy = false;
		}
	}

	async function goToCreate() {
		await goto(resolve(`${page.url.pathname}/create`));
	}

	async function openDetail(id: string) {
		await goto(resolve(`${page.url.pathname}/${id}`));
	}

	async function openEdit(id: string) {
		await goto(resolve(`${page.url.pathname}/${id}/edit`));
	}

	async function softDelete(id: string) {
		await client.mutation(runtime.delete, { id } as never);
		toast.success($t('admin.resources.toasts.deleted'));
	}

	async function restore(id: string) {
		await client.mutation(runtime.restore, { id } as never);
		toast.success($t('admin.resources.toasts.restored'));
	}

	async function replicate(id: string) {
		await client.mutation(runtime.replicate, { id } as never);
		toast.success($t('admin.resources.toasts.replicated'));
	}
</script>

<SEOHead
	title={$t('meta.admin.resource_index.title', {
		resource: $t(resource.navTitleKey)
	})}
	description={$t('meta.admin.resource_index.description', {
		resource: $t(resource.navTitleKey)
	})}
/>

<div class="flex flex-col gap-6 px-4 lg:px-6 xl:px-8 2xl:px-16" data-testid={`${prefix}-page`}>
	<div class="flex items-center justify-between gap-4">
		<div class="flex items-center gap-2">
			<ResourceIcon class="size-5 text-muted-foreground" />
			<h1 class="text-2xl font-bold"><T keyName={resource.navTitleKey} /></h1>
		</div>
		<Button onclick={() => void goToCreate()} data-testid={`${prefix}-create`}>
			<PlusIcon class="mr-2 size-4" />
			<T keyName="admin.resources.actions.create" />
		</Button>
	</div>

	<MetricsCards metrics={resource.metrics ?? []} values={metricsQuery.data?.cards ?? []} {prefix} />

	<ConvexCursorTableShell
		testIdPrefix={prefix}
		tableTestId={`${prefix}-table`}
		searchValue={tableParams.search}
		searchPlaceholder={$t('admin.resources.search_placeholder')}
		onSearchChange={resourceTable.setSearch}
		pageIndex={resourceTable.pageIndex}
		pageCount={resourceTable.pageCount}
		pageSize={resourceTable.pageSize}
		pageSizeOptions={pageSizeNumbers}
		canPreviousPage={resourceTable.canPreviousPage}
		canNextPage={resourceTable.canNextPage}
		onFirstPage={resourceTable.goFirst}
		onPreviousPage={resourceTable.goPrevious}
		onNextPage={resourceTable.goNext}
		onLastPage={resourceTable.goLast}
		onPageSizeChange={resourceTable.setPageSize}
		rowsPerPageLabel={$t('admin.resources.rows_per_page')}
		selectionText={$t('admin.resources.selected', {
			selected: selectedIds.length,
			total: resourceTable.totalCount
		})}
	>
		{#snippet toolbarFilters()}
			<div class="flex flex-wrap items-center gap-2">
				{#if (resource.filters?.length ?? 0) > 0}
					<FilterPanel
						{prefix}
						filters={resource.filters ?? []}
						values={resourceTable.filters}
						onFilterChange={setFilter}
						onClear={clearFilters}
					/>
				{/if}

				{#if (resource.lenses?.length ?? 0) > 0}
					<Select.Root type="single" value={activeLens} onValueChange={setLens}>
						<Select.Trigger data-testid={`${prefix}-lens-filter-trigger`} class="min-w-40">
							{#if activeLens === 'all'}
								<T keyName="admin.resources.lenses.all" />
							{:else}
								{#each resource.lenses ?? [] as lens (lens.key)}
									{#if lens.key === activeLens}
										<T keyName={lens.nameKey} />
									{/if}
								{/each}
							{/if}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="all" data-testid={`${prefix}-lens-filter-all`}>
								<T keyName="admin.resources.lenses.all" />
							</Select.Item>
							{#each resource.lenses ?? [] as lens (lens.key)}
								<Select.Item value={lens.key} data-testid={`${prefix}-lens-filter-${lens.key}`}>
									<T keyName={lens.nameKey} />
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				{/if}

				{#if resource.softDeletes}
					<Select.Root type="single" value={activeTrashed} onValueChange={setTrashed}>
						<Select.Trigger data-testid={`${prefix}-trashed-filter-trigger`} class="min-w-40">
							{#if activeTrashed === 'without'}
								<T keyName="admin.resources.trashed.without" />
							{:else if activeTrashed === 'with'}
								<T keyName="admin.resources.trashed.with" />
							{:else}
								<T keyName="admin.resources.trashed.only" />
							{/if}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="without" data-testid={`${prefix}-trashed-filter-without`}>
								<T keyName="admin.resources.trashed.without" />
							</Select.Item>
							<Select.Item value="with" data-testid={`${prefix}-trashed-filter-with`}>
								<T keyName="admin.resources.trashed.with" />
							</Select.Item>
							<Select.Item value="only" data-testid={`${prefix}-trashed-filter-only`}>
								<T keyName="admin.resources.trashed.only" />
							</Select.Item>
						</Select.Content>
					</Select.Root>
				{/if}

				{#if hasAnyFilters}
					<Button
						variant="outline"
						size="sm"
						onclick={clearFilters}
						data-testid={`${prefix}-filters-clear-all`}
					>
						<T keyName="admin.resources.filters.clear" />
					</Button>
				{/if}
			</div>
		{/snippet}

		{#snippet toolbarActions()}
			<div class="flex flex-wrap items-center gap-2">
				{#each availableActions as action (action.key)}
					<Button
						variant="outline"
						size="sm"
						onclick={() => void openAction(action)}
						disabled={!action.standalone && selectedIds.length === 0}
						data-testid={`${prefix}-action-${action.key}`}
					>
						<T keyName={action.nameKey} />
					</Button>
				{/each}
			</div>
		{/snippet}

		{#snippet tableContent()}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="w-10">
							<Checkbox
								checked={rows.length > 0 && selectedIds.length === rows.length}
								onCheckedChange={(checked) => toggleAllRows(Boolean(checked))}
								aria-label={$t('admin.resources.aria.select_all')}
							/>
						</Table.Head>
						{#each indexFields as field (field.attribute)}
							<Table.Head>
								{#if field.sortable}
									<Button
										variant="ghost"
										size="sm"
										onclick={() => handleSort(String(field.attribute))}
										data-testid={`${prefix}-sort-${field.attribute}`}
									>
										<T keyName={field.labelKey} />
									</Button>
								{:else}
									<T keyName={field.labelKey} />
								{/if}
							</Table.Head>
						{/each}
						<Table.Head class="w-40 text-right">
							<T keyName="admin.resources.columns.actions" />
						</Table.Head>
					</Table.Row>
				</Table.Header>

				<Table.Body>
					{#if resourceTable.isLoading}
						<Table.Row data-testid={`${prefix}-loading`}>
							<Table.Cell
								colspan={indexFields.length + 2}
								class="h-24 text-center text-muted-foreground"
							>
								<T keyName="admin.resources.loading" />
							</Table.Cell>
						</Table.Row>
					{:else if rows.length === 0}
						<Table.Row>
							<Table.Cell
								colspan={indexFields.length + 2}
								class="h-24 text-center text-muted-foreground"
								data-testid={`${prefix}-empty`}
							>
								<T keyName="admin.resources.empty" />
							</Table.Cell>
						</Table.Row>
					{:else}
						{#each rows as row (String(row._id))}
							<Table.Row data-testid={`${resource.name}-row-${row._id}`}>
								<Table.Cell>
									<Checkbox
										checked={isSelected(String(row._id))}
										onCheckedChange={(checked) => toggleRow(String(row._id), Boolean(checked))}
										aria-label={$t('admin.resources.aria.select_row')}
									/>
								</Table.Cell>
								{#each indexFields as field (field.attribute)}
									<Table.Cell>
										<FieldRenderer
											context="index"
											{field}
											record={row}
											value={field.resolveUsing ? field.resolveUsing(row) : row[field.attribute]}
											testId={`${resource.name}-${field.attribute}-cell`}
										/>
									</Table.Cell>
								{/each}
								<Table.Cell class="text-right">
									<div class="flex justify-end gap-1">
										<Button
											variant="ghost"
											size="icon"
											onclick={() => void openDetail(String(row._id))}
											data-testid={`${prefix}-row-view-${row._id}`}
										>
											<EyeIcon class="size-4" />
											<span class="sr-only"><T keyName="admin.resources.actions.view" /></span>
										</Button>
										<Button
											variant="ghost"
											size="icon"
											onclick={() => void openEdit(String(row._id))}
											data-testid={`${prefix}-row-edit-${row._id}`}
										>
											<PencilIcon class="size-4" />
											<span class="sr-only"><T keyName="admin.resources.actions.edit" /></span>
										</Button>
										<Button
											variant="ghost"
											size="icon"
											onclick={() => void replicate(String(row._id))}
											data-testid={`${prefix}-row-replicate-${row._id}`}
										>
											<CopyIcon class="size-4" />
											<span class="sr-only"><T keyName="admin.resources.actions.replicate" /></span>
										</Button>
										{#if row.deletedAt}
											<Button
												variant="ghost"
												size="icon"
												onclick={() => void restore(String(row._id))}
												data-testid={`${prefix}-row-restore-${row._id}`}
											>
												<Undo2Icon class="size-4" />
												<span class="sr-only"><T keyName="admin.resources.actions.restore" /></span>
											</Button>
										{:else}
											<Button
												variant="ghost"
												size="icon"
												onclick={() => void softDelete(String(row._id))}
												data-testid={`${prefix}-row-delete-${row._id}`}
											>
												<Trash2Icon class="size-4" />
												<span class="sr-only"><T keyName="admin.resources.actions.delete" /></span>
											</Button>
										{/if}
									</div>
								</Table.Cell>
							</Table.Row>
						{/each}
					{/if}
				</Table.Body>
			</Table.Root>
		{/snippet}
	</ConvexCursorTableShell>
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
	onConfirm={runActiveAction}
/>
