<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { T, getTranslate } from '@tolgee/svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { toast } from 'svelte-sonner';
	import { useConvexClient } from 'convex-svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import Undo2Icon from '@lucide/svelte/icons/undo-2';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ConvexCursorTableShell from '$lib/components/tables/convex-cursor-table-shell.svelte';
	import { createConvexCursorTable } from '$lib/tables/convex/create-convex-cursor-table.svelte';
	import type { CursorListResult } from '$lib/tables/convex/contract';
	import {
		getResourceContext,
		getPageSizeOptions,
		createResourceUrlSchema
	} from '$lib/admin/page-helpers';
	import FieldRenderer from '$lib/admin/fields/field-renderer.svelte';
	import InlineEditCell from '$lib/admin/fields/inline-edit-cell.svelte';
	import FilterPanel from '$lib/admin/components/filter-panel.svelte';
	import ActionModal from '$lib/admin/components/action-modal.svelte';
	import MetricsCards from '$lib/admin/components/metrics-cards.svelte';
	import type { ActionDefinition, FieldDefinition, FilterDefinition } from '$lib/admin/types';
	import { ConfirmDeleteDialog, confirmDelete } from '$lib/components/ui/confirm-delete-dialog';
	import {
		createOptimisticDelete,
		createOptimisticDeleteMany,
		createOptimisticForceDeleteMany,
		createOptimisticRestore,
		createOptimisticRestoreMany
	} from '$lib/admin/optimistic';
	import { executeResourceAction } from '$lib/admin/action-response';
	import { createCsvFromRows, createJsonFromRows, downloadTextFile } from '$lib/admin/export';
	import {
		getViewerUser,
		isFieldDisabled,
		isFieldVisible,
		isResourceCreatable,
		isResourceDeletable,
		isResourceUpdatable
	} from '$lib/admin/visibility';

	const { t } = getTranslate();
	const client = useConvexClient();
	const viewer = getViewerUser(page.data.viewer);

	const { resource, runtime, prefix } = getResourceContext(page.params.resource ?? '', viewer);
	const ResourceIcon = resource.icon;

	function mergeFilters(
		base: FilterDefinition[],
		overrides: FilterDefinition[] | undefined
	): FilterDefinition[] {
		if (!overrides || overrides.length === 0) return base;
		const merged = [...base];
		for (const filter of overrides) {
			const existingIndex = merged.findIndex((entry) => entry.urlKey === filter.urlKey);
			if (existingIndex >= 0) {
				merged[existingIndex] = filter;
			} else {
				merged.push(filter);
			}
		}
		return merged;
	}

	function mergeActions(
		base: ActionDefinition[],
		overrides: ActionDefinition[] | undefined
	): ActionDefinition[] {
		if (!overrides || overrides.length === 0) return base;
		const merged = [...base];
		for (const action of overrides) {
			const existingIndex = merged.findIndex((entry) => entry.key === action.key);
			if (existingIndex >= 0) {
				merged[existingIndex] = action;
			} else {
				merged.push(action);
			}
		}
		return merged;
	}

	function mergeFields(
		base: FieldDefinition<any>[],
		overrides: FieldDefinition<any>[] | undefined
	): FieldDefinition<any>[] {
		if (!overrides || overrides.length === 0) return base;
		const merged = [...base];
		for (const field of overrides) {
			const existingIndex = merged.findIndex((entry) => entry.attribute === field.attribute);
			if (existingIndex >= 0) {
				merged[existingIndex] = field;
			} else {
				merged.push(field);
			}
		}
		return merged;
	}

	const allConfiguredFilters = [
		...(resource.filters ?? []),
		...(resource.lenses ?? []).flatMap((lens) => lens.filters ?? [])
	].filter(
		(filter, index, array) => array.findIndex((entry) => entry.urlKey === filter.urlKey) === index
	);

	const defaultFilters = {
		lens: 'all',
		trashed: 'without',
		...Object.fromEntries(
			allConfiguredFilters.map((filter) => [filter.urlKey, filter.defaultValue])
		)
	} as Record<string, string>;

	const pageSizeOptions = getPageSizeOptions(resource.perPageOptions);
	const pageSizeNumbers = pageSizeOptions.map((option) => Number(option));
	const defaultPageSize = pageSizeOptions[0];

	const urlSchema = createResourceUrlSchema({
		filters: allConfiguredFilters.map((filter) => ({
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

	let metricRanges = $state<Record<string, string>>(
		Object.fromEntries(
			(resource.metrics ?? [])
				.filter((metric) => (metric.rangeOptions?.length ?? 0) > 0)
				.map((metric) => [metric.key, metric.rangeOptions?.[0]?.value ?? ''])
		)
	);
	let metricsCards = $state<any[]>([]);
	$effect(() => {
		void (async () => {
			const result = (await client.query(runtime.getMetrics, {
				ranges: metricRanges
			} as never)) as { cards?: Array<Record<string, unknown>> };
			metricsCards = result.cards ?? [];
		})();
	});
	const rows = $derived(resourceTable.rows);
	const tableParams = $derived(resourceTable.currentUrlState);
	const activeLens = $derived(String(tableParams.lens ?? 'all'));
	const activeTrashed = $derived(String(tableParams.trashed ?? 'without'));
	const canCreate = $derived(isResourceCreatable(resource, viewer));

	const activeLensDefinition = $derived(
		(resource.lenses ?? []).find((lens) => lens.key === activeLens)
	);
	const activeFilters = $derived(
		mergeFilters(resource.filters ?? [], activeLensDefinition?.filters)
	);
	const activeActions = $derived(
		mergeActions(resource.actions ?? [], activeLensDefinition?.actions)
	);
	const activeFields = $derived(mergeFields(resource.fields, activeLensDefinition?.fields));

	const indexFields = $derived.by(() => {
		const runtimeVisible = new SvelteSet<string>();
		for (const row of rows) {
			const visible = row._visibleFields;
			if (Array.isArray(visible)) {
				for (const name of visible) {
					runtimeVisible.add(String(name));
				}
			}
		}
		return activeFields.filter((field) => {
			if (field.showOnIndex === false) return false;
			if (!isFieldVisible(field, { user: viewer })) return false;
			if (runtimeVisible.size > 0 && !runtimeVisible.has(field.attribute)) return false;
			return true;
		});
	});

	let selectedRows = $state<Record<string, boolean>>({});
	const selectedIds = $derived(
		Object.entries(selectedRows)
			.filter(([, selected]) => selected)
			.map(([id]) => id)
	);

	const hasAnyFilters = $derived.by(() => {
		for (const filter of allConfiguredFilters) {
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
	let relationOptionsLoadError = $state(false);
	let previewRecord = $state<Record<string, unknown> | null>(null);

	const availableActions = $derived(
		activeActions.filter((action) => {
			if (action.showOnIndex === false) return false;
			if (typeof action.canRun !== 'function') return true;
			if (!viewer) return false;
			return action.canRun(viewer);
		})
	);

	function isSelected(id: string) {
		return Boolean(selectedRows[id]);
	}

	function getRowById(id: string) {
		return rows.find((row) => String(row._id) === id);
	}

	function canUpdateRow(row: Record<string, unknown>) {
		return isResourceUpdatable(resource, viewer, row);
	}

	function canDeleteRow(row: Record<string, unknown>) {
		return isResourceDeletable(resource, viewer, row);
	}

	function toggleRow(id: string, next: boolean) {
		selectedRows = {
			...selectedRows,
			[id]: next
		};
	}

	function isRowActionDisabled(action: ActionDefinition) {
		if (action.standalone) return false;
		if (action.sole) return selectedIds.length !== 1;
		return selectedIds.length === 0;
	}

	function shouldIgnoreRowClick(target: EventTarget | null) {
		if (!(target instanceof Element)) return false;
		return Boolean(target.closest('[data-no-row-click],button,a,input,[role=checkbox]'));
	}

	function handleRowClick(event: MouseEvent, id: string) {
		if (shouldIgnoreRowClick(event.target)) return;
		const clickAction = resource.clickAction ?? 'detail';
		if (clickAction === 'ignore') return;
		if (clickAction === 'select') {
			toggleRow(id, !isSelected(id));
			return;
		}
		const row = getRowById(id);
		if (!row) return;
		if (clickAction === 'edit') {
			void openEdit(id);
			return;
		}
		if (clickAction === 'preview') {
			previewRecord = row;
			return;
		}
		void openDetail(id);
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
		for (const filter of allConfiguredFilters) {
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

	async function executeAction(action: ActionDefinition, values: Record<string, unknown>) {
		const ids = action.standalone ? [] : [...selectedIds];
		await executeResourceAction({
			client,
			runtime,
			action: action.key,
			ids,
			values,
			navigateTo: async (url) => {
				await goto(resolve(url));
			}
		});
		selectedRows = {};
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
				console.error('Failed to load action relation options', error);
			}
		}
	}

	async function runActiveAction() {
		if (!activeAction) return;
		actionBusy = true;
		try {
			await executeAction(activeAction, actionValues);
			actionOpen = false;
		} catch (error) {
			const message =
				error instanceof Error ? error.message : $t('admin.resources.toasts.action_error');
			toast.error(message);
		} finally {
			actionBusy = false;
		}
	}

	async function goToCreate() {
		if (!canCreate) return;
		await goto(resolve(`${page.url.pathname}/create`));
	}

	async function openDetail(id: string) {
		await goto(resolve(`${page.url.pathname}/${id}`));
	}

	async function openEdit(id: string) {
		const row = getRowById(id);
		if (row && !canUpdateRow(row)) return;
		await goto(resolve(`${page.url.pathname}/${id}/edit`));
	}

	async function softDelete(id: string) {
		const row = getRowById(id);
		if (row && !canDeleteRow(row)) return;
		await client.mutation(runtime.delete, { id } as never, {
			optimisticUpdate: createOptimisticDelete(runtime.list, id)
		});
		toast.success($t('admin.resources.toasts.deleted'));
	}

	function confirmSoftDelete(id: string) {
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
				await softDelete(id);
			}
		});
	}

	async function restore(id: string) {
		const row = getRowById(id);
		if (row && !canDeleteRow(row)) return;
		await client.mutation(runtime.restore, { id } as never, {
			optimisticUpdate: createOptimisticRestore(runtime.list, id)
		});
		toast.success($t('admin.resources.toasts.restored'));
	}

	async function replicate(id: string) {
		const row = getRowById(id);
		if (row && !canUpdateRow(row)) return;
		await client.mutation(runtime.replicate, { id } as never);
		toast.success($t('admin.resources.toasts.replicated'));
	}

	const canBulkDelete = $derived.by(() => {
		if (selectedIds.length === 0) return false;
		if (resource.softDeletes) {
			return activeTrashed !== 'only';
		}
		return true;
	});

	const canBulkRestore = $derived.by(() => {
		if (!resource.softDeletes) return false;
		return selectedIds.length > 0 && activeTrashed === 'only';
	});

	const canBulkForceDelete = $derived.by(() => {
		if (!resource.softDeletes) return false;
		return selectedIds.length > 0 && activeTrashed === 'only';
	});

	function buildListArgsForCursor(cursor?: string) {
		return {
			cursor,
			numItems: Math.min(resourceTable.pageSize, 250),
			search: String(tableParams.search ?? ''),
			sortBy: resourceTable.sortBy,
			filters: resourceTable.filters,
			lens: activeLens === 'all' ? undefined : activeLens,
			trashed: (activeTrashed as 'without' | 'with' | 'only' | undefined) ?? 'without'
		};
	}

	function buildCountArgs() {
		return {
			search: String(tableParams.search ?? ''),
			filters: resourceTable.filters,
			lens: activeLens === 'all' ? undefined : activeLens,
			trashed: (activeTrashed as 'without' | 'with' | 'only' | undefined) ?? 'without'
		};
	}

	async function bulkDeleteSelected() {
		if (!canBulkDelete) return;
		const optimistic = createOptimisticDeleteMany(runtime.list, selectedIds);
		await Promise.all(
			selectedIds.map((id) =>
				client.mutation(runtime.delete, { id } as never, {
					optimisticUpdate: optimistic
				})
			)
		);
		selectedRows = {};
		toast.success($t('admin.resources.toasts.deleted'));
	}

	async function bulkRestoreSelected() {
		if (!canBulkRestore) return;
		const optimistic = createOptimisticRestoreMany(runtime.list, selectedIds);
		await Promise.all(
			selectedIds.map((id) =>
				client.mutation(runtime.restore, { id } as never, {
					optimisticUpdate: optimistic
				})
			)
		);
		selectedRows = {};
		toast.success($t('admin.resources.toasts.restored'));
	}

	async function bulkForceDeleteSelected() {
		if (!canBulkForceDelete) return;
		const optimistic = createOptimisticForceDeleteMany(runtime.list, selectedIds);
		await Promise.all(
			selectedIds.map((id) =>
				client.mutation(runtime.forceDelete, { id } as never, {
					optimisticUpdate: optimistic
				})
			)
		);
		selectedRows = {};
		toast.success($t('admin.resources.toasts.force_deleted'));
	}

	function confirmBulkDeleteSelected() {
		confirmDelete({
			title: $t('admin.resources.bulk.delete'),
			description: $t('admin.resources.bulk.delete_description', { count: selectedIds.length }),
			confirm: { text: $t('admin.resources.bulk.delete') },
			cancel: { text: $t('common.cancel') },
			onConfirm: async () => {
				await bulkDeleteSelected();
			}
		});
	}

	function confirmBulkForceDeleteSelected() {
		confirmDelete({
			title: $t('admin.resources.bulk.force_delete'),
			description: $t('admin.resources.bulk.force_delete_description', {
				count: selectedIds.length
			}),
			confirm: { text: $t('admin.resources.bulk.force_delete') },
			cancel: { text: $t('common.cancel') },
			onConfirm: async () => {
				await bulkForceDeleteSelected();
			}
		});
	}

	async function fetchRowsForExport(limit = 5000) {
		const count = (await client.query(runtime.count, buildCountArgs() as never)) as number;
		if (count > limit) {
			throw new Error($t('admin.resources.export.limit_error', { limit }));
		}
		let cursor: string | undefined = undefined;
		const items: Record<string, unknown>[] = [];
		while (true) {
			const pageResult = (await client.query(
				runtime.list,
				buildListArgsForCursor(cursor) as never
			)) as {
				items: Record<string, unknown>[];
				continueCursor: string | null;
				isDone: boolean;
			};
			items.push(...(pageResult.items ?? []));
			if (pageResult.isDone || !pageResult.continueCursor) {
				break;
			}
			cursor = pageResult.continueCursor;
		}
		return items;
	}

	function getExportableFields() {
		return activeFields.filter((field) => field.showOnIndex !== false);
	}

	async function exportCsv() {
		try {
			const rowsForExport = await fetchRowsForExport();
			const fields = getExportableFields();
			const content = createCsvFromRows({
				fields,
				rows: rowsForExport
			});
			downloadTextFile({
				filename: `${resource.name}.csv`,
				content,
				mimeType: 'text/csv'
			});
			toast.success($t('admin.resources.export.success_csv'));
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : $t('admin.resources.toasts.action_error')
			);
		}
	}

	async function exportJson() {
		try {
			const rowsForExport = await fetchRowsForExport();
			const fields = getExportableFields();
			const content = createJsonFromRows({
				fields,
				rows: rowsForExport
			});
			downloadTextFile({
				filename: `${resource.name}.json`,
				content,
				mimeType: 'application/json'
			});
			toast.success($t('admin.resources.export.success_json'));
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : $t('admin.resources.toasts.action_error')
			);
		}
	}

	function setMetricRange(metricKey: string, value: string) {
		metricRanges = {
			...metricRanges,
			[metricKey]: value
		};
	}

	const previewFields = $derived(
		activeFields.filter((field) => field.showOnIndex !== false).slice(0, 6)
	);
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
		{#if canCreate}
			<Button onclick={() => void goToCreate()} data-testid={`${prefix}-create`}>
				<PlusIcon class="mr-2 size-4" />
				<T keyName="admin.resources.actions.create" />
			</Button>
		{/if}
	</div>

	<MetricsCards
		metrics={resource.metrics ?? []}
		values={metricsCards}
		selectedRanges={metricRanges}
		onRangeChange={setMetricRange}
		{prefix}
	/>

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
				{#if activeFilters.length > 0}
					<FilterPanel
						{prefix}
						filters={activeFilters}
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
				{#if canBulkDelete}
					<Button
						variant="outline"
						size="sm"
						onclick={confirmBulkDeleteSelected}
						data-testid={`${prefix}-bulk-delete`}
					>
						<Trash2Icon class="mr-2 size-4" />
						<T keyName="admin.resources.bulk.delete" />
					</Button>
				{/if}
				{#if canBulkRestore}
					<Button
						variant="outline"
						size="sm"
						onclick={() => void bulkRestoreSelected()}
						data-testid={`${prefix}-bulk-restore`}
					>
						<Undo2Icon class="mr-2 size-4" />
						<T keyName="admin.resources.bulk.restore" />
					</Button>
				{/if}
				{#if canBulkForceDelete}
					<Button
						variant="destructive"
						size="sm"
						onclick={confirmBulkForceDeleteSelected}
						data-testid={`${prefix}-bulk-force-delete`}
					>
						<Trash2Icon class="mr-2 size-4" />
						<T keyName="admin.resources.bulk.force_delete" />
					</Button>
				{/if}
				<Button
					variant="outline"
					size="sm"
					onclick={() => void exportCsv()}
					data-testid={`${prefix}-export-csv`}
				>
					<DownloadIcon class="mr-2 size-4" />
					<T keyName="admin.resources.export.csv" />
				</Button>
				<Button
					variant="outline"
					size="sm"
					onclick={() => void exportJson()}
					data-testid={`${prefix}-export-json`}
				>
					<DownloadIcon class="mr-2 size-4" />
					<T keyName="admin.resources.export.json" />
				</Button>
				{#each availableActions as action (action.key)}
					<Button
						variant="outline"
						size="sm"
						onclick={() => void openAction(action)}
						disabled={isRowActionDisabled(action)}
						data-testid={`${prefix}-action-${action.key}`}
					>
						{#if action.icon}
							{@const ActionIcon = action.icon}
							<ActionIcon class="mr-2 size-4" />
						{/if}
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
								data-no-row-click="true"
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
							<Table.Row
								data-testid={`${resource.name}-row-${row._id}`}
								onclick={(event) => handleRowClick(event, String(row._id))}
							>
								<Table.Cell>
									<Checkbox
										checked={isSelected(String(row._id))}
										onCheckedChange={(checked) => toggleRow(String(row._id), Boolean(checked))}
										aria-label={$t('admin.resources.aria.select_row')}
										data-no-row-click="true"
									/>
								</Table.Cell>
								{#each indexFields as field (field.attribute)}
									<Table.Cell>
										{@const visibleForRow = isFieldVisible(field, { user: viewer, record: row })}
										{#if visibleForRow && field.inlineEditable && canUpdateRow(row) && !isFieldDisabled( field, { user: viewer, record: row, isEdit: true } )}
											<InlineEditCell
												{field}
												record={row}
												value={field.resolveUsing ? field.resolveUsing(row) : row[field.attribute]}
												{runtime}
												testId={`${resource.name}-${field.attribute}-cell`}
											/>
										{:else}
											<FieldRenderer
												context="index"
												{field}
												record={row}
												value={visibleForRow
													? field.resolveUsing
														? field.resolveUsing(row)
														: row[field.attribute]
													: '-'}
												testId={`${resource.name}-${field.attribute}-cell`}
											/>
										{/if}
									</Table.Cell>
								{/each}
								<Table.Cell class="text-right">
									<div class="flex justify-end gap-1">
										<Button
											variant="ghost"
											size="icon"
											onclick={() => void openDetail(String(row._id))}
											data-testid={`${prefix}-row-view-${row._id}`}
											data-no-row-click="true"
										>
											<EyeIcon class="size-4" />
											<span class="sr-only"><T keyName="admin.resources.actions.view" /></span>
										</Button>
										<Button
											variant="ghost"
											size="icon"
											onclick={() => void openEdit(String(row._id))}
											data-testid={`${prefix}-row-edit-${row._id}`}
											data-no-row-click="true"
											disabled={!canUpdateRow(row)}
										>
											<PencilIcon class="size-4" />
											<span class="sr-only"><T keyName="admin.resources.actions.edit" /></span>
										</Button>
										<Button
											variant="ghost"
											size="icon"
											onclick={() => void replicate(String(row._id))}
											data-testid={`${prefix}-row-replicate-${row._id}`}
											data-no-row-click="true"
											disabled={!canUpdateRow(row)}
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
												data-no-row-click="true"
												disabled={!canDeleteRow(row)}
											>
												<Undo2Icon class="size-4" />
												<span class="sr-only"><T keyName="admin.resources.actions.restore" /></span>
											</Button>
										{:else}
											<Button
												variant="ghost"
												size="icon"
												onclick={() => confirmSoftDelete(String(row._id))}
												data-testid={`${prefix}-row-delete-${row._id}`}
												data-no-row-click="true"
												disabled={!canDeleteRow(row)}
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

<Dialog.Root
	open={previewRecord !== null}
	onOpenChange={(open) => {
		if (!open) {
			previewRecord = null;
		}
	}}
>
	<Dialog.Content data-testid={`${prefix}-preview-dialog`}>
		{#if previewRecord}
			<Dialog.Header>
				<Dialog.Title><T keyName="admin.resources.sections.preview" /></Dialog.Title>
				<Dialog.Description>{resource.title(previewRecord as never)}</Dialog.Description>
			</Dialog.Header>
			<div class="grid gap-4 md:grid-cols-2" data-testid={`${prefix}-preview-content`}>
				{#each previewFields as field (field.attribute)}
					{#if isFieldVisible(field, { user: viewer, record: previewRecord })}
						<FieldRenderer
							context="preview"
							{field}
							record={previewRecord}
							value={field.resolveUsing
								? field.resolveUsing(previewRecord)
								: previewRecord[field.attribute]}
						/>
					{/if}
				{/each}
			</div>
			<Dialog.Footer>
				<Button
					variant="outline"
					onclick={() => {
						previewRecord = null;
					}}
				>
					<T keyName="common.cancel" />
				</Button>
				<Button
					onclick={() => {
						if (!previewRecord?._id) return;
						void openDetail(String(previewRecord._id));
						previewRecord = null;
					}}
					data-testid={`${prefix}-preview-open-detail`}
				>
					<T keyName="admin.resources.actions.view" />
				</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>

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
	onConfirm={runActiveAction}
/>

<ConfirmDeleteDialog />
