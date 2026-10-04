export type CursorListResult<TItem> =
	| { items: TItem[]; continueCursor: string; isDone: false }
	| { items: TItem[]; continueCursor: null; isDone: true };

/**
 * Build the correlated list result from a Convex page whose validator types
 * `isDone` and the cursor independently. A done page or a missing cursor ends
 * the list; only a pending page keeps its cursor.
 */
export function toCursorListResult<TItem>(page: {
	items: TItem[];
	continueCursor: string | null;
	isDone: boolean;
}): CursorListResult<TItem> {
	if (page.isDone || !page.continueCursor) {
		return { items: page.items, continueCursor: null, isDone: true };
	}
	return { items: page.items, continueCursor: page.continueCursor, isDone: false };
}

export type TableSortDirection = 'asc' | 'desc';

export type TableSortBy<TField extends string> = {
	field: TField;
	direction: TableSortDirection;
};

export type CanonicalTableUrlState = {
	search: string;
	sort: string;
	page: string;
	page_size: string;
	cursor: string;
};

export type TableUrlState<TFilterKeys extends string = never> = CanonicalTableUrlState &
	Record<TFilterKeys, string>;
