<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { T, getTranslate } from '@tolgee/svelte';
	import type { ColumnDef } from '@tanstack/table-core';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { renderComponent } from '$lib/components/ui/data-table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import type { FieldDefinition } from '$lib/admin/types';
	import { getResourceByName, getResourceRuntime } from '$lib/admin/registry';
	import { ConfirmDeleteDialog, confirmDelete } from '$lib/components/ui/confirm-delete-dialog';
	import { createBaseTanStackTable } from '$lib/tables/core/create-base-tanstack-table.svelte';
	import BaseTanStackTable from '$lib/tables/core/base-tanstack-table.svelte';
	import type { BaseTableRenderConfig } from '$lib/tables/core/types';
	import { getTableSkeletonColumnsFromColumnDefs } from '$lib/components/tables/table-loading-skeleton.js';
	import { applyColumnLayoutPreset, COLUMN_LAYOUT_PRESETS } from '$lib/tables/core/layout-presets';
	import RelatedResourceActionsCell from '$lib/admin/components/related-resource-actions-cell.svelte';
	import TableLoadingActionIconsCell from '$lib/admin/components/table-loading-action-icons-cell.svelte';
	import TableLoadingTextCell from '$lib/admin/components/table-loading-text-cell.svelte';

	const DEFAULT_PER_PAGE_OPTIONS = [5, 10, 25] as const;

	type Props = {
		field: FieldDefinition<any>;
		record: Record<string, unknown>;
		lang: string;
		prefix: string;
		resourceName: string;
	};

	let { field, record, lang, prefix, resourceName }: Props = $props();

	const client = useConvexClient();
	const { t } = getTranslate();

	const relation = $derived(field.relation);
	const relatedResource = $derived(
		relation?.resourceName ? getResourceByName(relation.resourceName) : undefined
	);
	const relatedRuntime = $derived(
		relatedResource ? getResourceRuntime(relatedResource.name) : undefined
	);
	const foreignKey = $derived(relation?.foreignKey ?? '');
	const parentId = $derived(String(record._id ?? ''));

	const perPageOptions: number[] = $derived(
		relation?.perPageOptions?.length ? relation.perPageOptions : [...DEFAULT_PER_PAGE_OPTIONS]
	);

	let pageSize = $state(0);
	let pageIndex = $state(0);
	let cursorStack: string[] = $state([]);

	$effect(() => {
		const first = perPageOptions[0] ?? 5;
		if (pageSize === 0 || !perPageOptions.includes(pageSize)) {
			pageSize = first;
		}
	});

	const currentCursor = $derived(pageIndex === 0 ? undefined : cursorStack[pageIndex - 1]);

	const relatedListQuery = relatedRuntime
		? useQuery(relatedRuntime.list, () =>
				parentId && pageSize > 0
					? ({
							cursor: currentCursor,
							numItems: pageSize,
							filters: {
								[foreignKey]: parentId
							},
							trashed: 'with'
						} as never)
					: 'skip'
			)
		: undefined;

	const relatedCountQuery = relatedRuntime
		? useQuery(relatedRuntime.count, () =>
				parentId
					? ({
							filters: {
								[foreignKey]: parentId
							},
							trashed: 'with'
						} as never)
					: 'skip'
			)
		: undefined;

	type ListResponse = {
		items?: Record<string, unknown>[];
		continueCursor?: string;
		isDone?: boolean;
	};

	const listResponse = $derived.by<ListResponse>(() => {
		const data = relatedListQuery?.data as ListResponse | undefined;
		return data ?? {};
	});
	const relatedRows = $derived.by<Record<string, unknown>[]>(() => listResponse.items ?? []);
	const continueCursor = $derived(listResponse.continueCursor);
	const isDone = $derived(listResponse.isDone ?? true);
	const loading = $derived(relatedListQuery?.isLoading ?? false);
	const totalCount = $derived.by(() => {
		if (typeof relatedCountQuery?.data === 'number') return relatedCountQuery.data;
		return relatedRows.length;
	});

	const pageCount = $derived.by(() => {
		if (totalCount === 0 || pageSize === 0) return 1;
		return Math.ceil(totalCount / pageSize);
	});
	const canPreviousPage = $derived(pageIndex > 0);
	const canNextPage = $derived(!isDone && !!continueCursor);

	function goToPreviousPage() {
		if (!canPreviousPage) return;
		pageIndex = pageIndex - 1;
	}

	function goToNextPage() {
		if (!canNextPage || !continueCursor) return;
		if (cursorStack.length <= pageIndex) {
			cursorStack = [...cursorStack, continueCursor];
		} else {
			cursorStack[pageIndex] = continueCursor;
		}
		pageIndex = pageIndex + 1;
	}

	function handlePageSizeChange(newSize: number) {
		pageSize = newSize;
		pageIndex = 0;
		cursorStack = [];
	}

	function viaParams() {
		const id = String(record._id ?? '');
		if (!id) return '';
		return `?via=${resourceName}&viaId=${id}`;
	}

	async function openRow(id: string) {
		if (!relatedResource) return;
		await goto(resolve(`/${lang}/admin/${relatedResource.name}/${id}`));
	}

	async function openEditRow(id: string) {
		if (!relatedResource) return;
		await goto(resolve(`/${lang}/admin/${relatedResource.name}/${id}/edit${viaParams()}`));
	}

	async function createRelated() {
		if (!relatedResource) return;
		await goto(resolve(`/${lang}/admin/${relatedResource.name}/create${viaParams()}`));
	}

	function deleteRow(id: string) {
		if (!relatedRuntime) return;
		confirmDelete({
			title: $t('admin.resources.actions.delete'),
			description: $t('admin.resources.confirm.delete_description'),
			confirm: { text: $t('admin.resources.actions.delete') },
			cancel: { text: $t('common.cancel') },
			onConfirm: async () => {
				await client.mutation(relatedRuntime.delete, { id } as never);
			}
		});
	}

	const columns = $derived.by<ColumnDef<Record<string, unknown>>[]>(() => [
		applyColumnLayoutPreset({
			preset: COLUMN_LAYOUT_PRESETS.relationTitle,
			column: {
				id: 'title',
				header: () => $t(relatedResource?.navTitleKey ?? 'admin.resources.empty'),
				cell: ({ row }) => String(relatedResource?.title(row.original as never) ?? '-')
			}
		}),
		applyColumnLayoutPreset({
			preset: COLUMN_LAYOUT_PRESETS.actionsInline3,
			column: {
				id: 'actions',
				header: () => $t('admin.resources.columns.actions'),
				cell: ({ row }) =>
					renderComponent(RelatedResourceActionsCell, {
						row: row.original,
						prefix,
						onView: () => void openRow(String(row.original._id)),
						onEdit: () => void openEditRow(String(row.original._id)),
						onDelete: () => deleteRow(String(row.original._id))
					})
			}
		})
	]);

	const table = createBaseTanStackTable({
		columns: [],
		getColumns: () => columns,
		getData: () => relatedRows,
		getIsLoading: () => loading,
		getRowId: (row) => String(row._id),
		enableRowSelection: false
	});

	const skeletonColumns = $derived.by(() => getTableSkeletonColumnsFromColumnDefs(columns));
	const testIdBase = $derived(`${prefix}-${field.attribute}-related`);

	const renderConfig = $derived.by<BaseTableRenderConfig>(() => ({
		testIdPrefix: testIdBase,
		searchValue: '',
		searchPlaceholder: '',
		onSearchChange: () => {},
		showSearch: false,
		pageIndex,
		pageCount,
		pageSize,
		pageSizeOptions: perPageOptions,
		showRowsPerPage: false,
		canPreviousPage,
		canNextPage,
		onFirstPage: () => {},
		onPreviousPage: goToPreviousPage,
		onNextPage: goToNextPage,
		onLastPage: () => {},
		onPageSizeChange: handlePageSizeChange,
		rowsPerPageLabel: '',
		emptyKey: 'admin.resources.empty',
		loadingLabelKey: 'admin.resources.loading',
		loadingStrategy: 'column-factory',
		loadingCellFactory: ({ columnId }) => {
			if (columnId === 'actions') {
				return renderComponent(TableLoadingActionIconsCell, { iconCount: 3 });
			}
			return renderComponent(TableLoadingTextCell, { widthClass: 'w-32' });
		},
		skeletonColumns,
		skeletonRowCount: loading ? Math.min(pageSize || 5, Math.max(totalCount, 1)) : 0,
		colspan: columns.length,
		testIds: {
			table: `${testIdBase}-table`
		}
	}));
</script>

{#if relatedResource && relatedRuntime && foreignKey}
	<div class="space-y-3">
		<div class="flex items-center justify-between">
			<h3 class="text-sm font-medium"><T keyName={field.labelKey} /></h3>
			<Button size="sm" variant="outline" onclick={() => void createRelated()}>
				<PlusIcon class="mr-2 size-4" />
				<T keyName="admin.resources.actions.create" />
			</Button>
		</div>
		<BaseTanStackTable table={table.table} config={renderConfig} />
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				<span class="text-xs text-muted-foreground">
					{$t('admin.resources.rows_per_page')}
				</span>
				<Select.Root
					type="single"
					value={`${pageSize}`}
					onValueChange={(value) => handlePageSizeChange(Number(value))}
				>
					<Select.Trigger
						size="sm"
						class="h-7 w-16 text-xs"
						data-testid={`${testIdBase}-page-size`}
					>
						{pageSize}
					</Select.Trigger>
					<Select.Content side="top">
						{#each perPageOptions as option (option)}
							<Select.Item value={`${option}`}>{option}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<div class="flex items-center gap-1">
				<span class="text-xs text-muted-foreground" data-testid={`${testIdBase}-page-indicator`}>
					{$t('admin.users.page_indicator', {
						current: pageIndex + 1,
						total: pageCount
					})}
				</span>
				<Button
					variant="ghost"
					size="icon"
					class="size-7"
					onclick={goToPreviousPage}
					disabled={!canPreviousPage}
					data-testid={`${testIdBase}-pagination-prev`}
				>
					<span class="sr-only">{$t('admin.users.pagination.previous')}</span>
					<ChevronLeftIcon class="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					class="size-7"
					onclick={goToNextPage}
					disabled={!canNextPage}
					data-testid={`${testIdBase}-pagination-next`}
				>
					<span class="sr-only">{$t('admin.users.pagination.next')}</span>
					<ChevronRightIcon class="size-4" />
				</Button>
			</div>
		</div>
	</div>
{/if}

<ConfirmDeleteDialog />
