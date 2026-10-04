import {
	columnFilteringFeature,
	columnSizingFeature,
	columnVisibilityFeature,
	rowPaginationFeature,
	rowSelectionFeature,
	rowSortingFeature,
	tableFeatures,
	type CellContext,
	type RowData,
	type TableOptions
} from '@tanstack/table-core';
import { createTable, renderComponent } from '@tanstack/svelte-table';
import TruncatedText from '$lib/components/truncated-text.svelte';
import type { DataTableSkeleton } from '$lib/components/tables/skeleton.ts';

export type DataTableColumnMeta = {
	/** Placeholder `DataTableView` renders for this column while the table loads. */
	skeleton?: DataTableSkeleton;
};

// Row processing remains in Convex; these features expose the existing table controls.
// `columnMeta` is a type-only slot that types `columnDef.meta` for these tables.
export const dataTableFeatures = tableFeatures({
	columnFilteringFeature,
	columnSizingFeature,
	columnVisibilityFeature,
	rowPaginationFeature,
	rowSelectionFeature,
	rowSortingFeature,
	columnMeta: {} as DataTableColumnMeta
});

export type DataTableFeatures = typeof dataTableFeatures;

/**
 * Render single-line cell text that truncates within its column and reveals the
 * full value in a tooltip only while it is clipped. Truncation needs a bounded
 * column width, which the tables get from `table-fixed` and their header widths.
 */
export function renderTextCell(
	text: string,
	options?: { class?: string; testId?: string }
): ReturnType<typeof renderComponent> {
	return renderComponent(TruncatedText, {
		text,
		class: options?.class,
		testId: options?.testId
	});
}

export function createSvelteTable<TData extends RowData>(
	options: Omit<TableOptions<DataTableFeatures, TData>, 'features'>
) {
	// Columns without their own `cell` render their value as truncating text. This
	// stringifies like TanStack's built-in default, so 0 and false stay visible. A
	// caller `defaultColumn` replaces this object as a whole, as TanStack options do.
	const defaultColumn = {
		cell: (props: CellContext<DataTableFeatures, TData>) => {
			const value = props.renderValue() as { toString?: () => string } | null | undefined;
			const text = value?.toString?.();
			return text ? renderTextCell(text) : null;
		}
	};
	return createTable(
		Object.defineProperties(
			{ features: dataTableFeatures, defaultColumn },
			Object.getOwnPropertyDescriptors(options)
		) as TableOptions<DataTableFeatures, TData>
	);
}
