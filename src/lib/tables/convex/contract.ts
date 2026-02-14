export type CursorListResult<TItem> =
	| { items: TItem[]; continueCursor: string; isDone: false }
	| { items: TItem[]; continueCursor: null; isDone: true };

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
