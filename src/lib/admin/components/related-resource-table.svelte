<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { T, getTranslate } from '@tolgee/svelte';
	import type { ColumnDef } from '@tanstack/table-core';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { renderComponent } from '$lib/components/ui/data-table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
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

	type Props = {
		field: FieldDefinition<any>;
		record: Record<string, unknown>;
		lang: string;
		prefix: string;
	};

	let { field, record, lang, prefix }: Props = $props();

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
	const relatedListQuery = relatedRuntime
		? useQuery(relatedRuntime.list, () =>
				parentId
					? ({
							cursor: undefined,
							numItems: 10,
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

	const relatedRows = $derived.by<Record<string, unknown>[]>(
		() => (relatedListQuery?.data as { items?: Record<string, unknown>[] } | undefined)?.items ?? []
	);
	const loading = $derived(relatedListQuery?.isLoading ?? false);
	const totalCount = $derived.by(() => {
		if (typeof relatedCountQuery?.data === 'number') return relatedCountQuery.data;
		return relatedRows.length;
	});

	async function openRow(id: string) {
		if (!relatedResource) return;
		await goto(resolve(`/${lang}/admin/${relatedResource.name}/${id}`));
	}

	async function openEditRow(id: string) {
		if (!relatedResource) return;
		await goto(resolve(`/${lang}/admin/${relatedResource.name}/${id}/edit`));
	}

	async function createRelated() {
		if (!relatedResource) return;
		await goto(resolve(`/${lang}/admin/${relatedResource.name}/create`));
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

	const renderConfig = $derived.by<BaseTableRenderConfig>(() => ({
		testIdPrefix: `${prefix}-${field.attribute}-related`,
		searchValue: '',
		searchPlaceholder: '',
		onSearchChange: () => {},
		showSearch: false,
		pageIndex: 0,
		pageCount: 1,
		pageSize: Math.max(relatedRows.length, 1),
		pageSizeOptions: [10],
		showRowsPerPage: false,
		canPreviousPage: false,
		canNextPage: false,
		onFirstPage: () => {},
		onPreviousPage: () => {},
		onNextPage: () => {},
		onLastPage: () => {},
		onPageSizeChange: () => {},
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
		skeletonRowCount: loading ? Math.min(10, Math.max(totalCount, 1)) : 0,
		colspan: columns.length,
		testIds: {
			table: `${prefix}-${field.attribute}-related-table`
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
	</div>
{/if}

<ConfirmDeleteDialog />
