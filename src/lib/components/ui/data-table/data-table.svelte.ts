import {
	columnFilteringFeature,
	columnSizingFeature,
	columnVisibilityFeature,
	rowPaginationFeature,
	rowSelectionFeature,
	rowSortingFeature,
	tableFeatures,
	type RowData,
	type TableOptions
} from '@tanstack/table-core';
import { createTable } from '@tanstack/svelte-table';

// Row processing remains in Convex; these features expose the existing table controls.
export const dataTableFeatures = tableFeatures({
	columnFilteringFeature,
	columnSizingFeature,
	columnVisibilityFeature,
	rowPaginationFeature,
	rowSelectionFeature,
	rowSortingFeature
});

export type DataTableFeatures = typeof dataTableFeatures;

export function createSvelteTable<TData extends RowData>(
	options: Omit<TableOptions<DataTableFeatures, TData>, 'features'>
) {
	return createTable(
		Object.defineProperties(
			{ features: dataTableFeatures },
			Object.getOwnPropertyDescriptors(options)
		) as TableOptions<DataTableFeatures, TData>
	);
}
