import * as v from 'valibot';
import type {
	CanonicalTableUrlState,
	TableSortBy,
	TableSortDirection,
	TableUrlState
} from './contract';

const SORT_DIRECTIONS: TableSortDirection[] = ['asc', 'desc'];
const SORT_PATTERN = /^([a-zA-Z0-9_]+)\.(asc|desc)$/u;
const SAFE_CURSOR_PATTERN = /^[A-Za-z0-9._~-]+$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const CURSOR_B64_PREFIX = 'b64.';

function toBase64Url(value: string): string {
	if (typeof Buffer !== 'undefined') {
		return Buffer.from(value, 'utf8').toString('base64url');
	}

	const bytes = new TextEncoder().encode(value);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function fromBase64Url(value: string): string {
	if (typeof Buffer !== 'undefined') {
		return Buffer.from(value, 'base64url').toString('utf8');
	}

	const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
	const padded = base64 + '='.repeat((4 - (base64.length % 4 || 4)) % 4);
	const binary = atob(padded);
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

export function parseSortParam<TField extends string>(
	sort: string,
	validFields: readonly TField[]
): TableSortBy<TField> | undefined {
	if (!sort) return undefined;

	const match = SORT_PATTERN.exec(sort.trim());
	if (!match) return undefined;

	const field = match[1] as TField;
	const direction = match[2] as TableSortDirection;
	if (!validFields.includes(field) || !SORT_DIRECTIONS.includes(direction)) return undefined;

	return { field, direction };
}

export function serializeSortParam<TField extends string>(sortBy: TableSortBy<TField> | undefined) {
	if (!sortBy) return '';
	return `${sortBy.field}.${sortBy.direction}`;
}

export function parsePageIndex(page: string): number {
	const parsed = Number.parseInt(page, 10);
	if (!Number.isFinite(parsed) || parsed < 1) return 0;
	return parsed - 1;
}

export function parsePageSize(pageSize: string, fallback: number): number {
	const parsed = Number.parseInt(pageSize, 10);
	if (!Number.isFinite(parsed) || parsed < 1) return fallback;
	return parsed;
}

export function serializeCursorParam(cursor: string | null | undefined): string {
	if (!cursor) return '';
	if (SAFE_CURSOR_PATTERN.test(cursor)) return cursor;
	return `${CURSOR_B64_PREFIX}${toBase64Url(cursor)}`;
}

export function parseCursorParam(cursor: string): string | null {
	if (!cursor) return null;
	if (!cursor.startsWith(CURSOR_B64_PREFIX)) return cursor;
	const encoded = cursor.slice(CURSOR_B64_PREFIX.length);
	if (!encoded || !BASE64URL_PATTERN.test(encoded)) return null;

	try {
		const decoded = fromBase64Url(encoded);
		return decoded ? decoded : null;
	} catch {
		return null;
	}
}

/** @public Table-kit utility kept for forks: strips default URL params from table state before serializing. */
export function omitDefaultTableUrlState<TFilterKeys extends string>(
	state: TableUrlState<TFilterKeys>,
	defaults: TableUrlState<TFilterKeys>
): Partial<TableUrlState<TFilterKeys>> {
	const next: Partial<Record<keyof TableUrlState<TFilterKeys>, string>> = {};
	const entries = Object.entries(state) as Array<[keyof TableUrlState<TFilterKeys>, string]>;

	for (const [key, value] of entries) {
		if (value === defaults[key]) continue;
		if (value === '') continue;
		next[key] = value;
	}

	return next as Partial<TableUrlState<TFilterKeys>>;
}

/** A filter URL param: a picklist that falls back to its first option, or free text that falls back to ''. */
export type TableUrlFilter = readonly [string, ...string[]] | 'text';

type TableUrlFilterState<TFilters extends Record<string, TableUrlFilter>> = {
	[TKey in keyof TFilters]: TFilters[TKey] extends readonly string[]
		? TFilters[TKey][number]
		: string;
};

function urlText(fallback: string) {
	return v.optional(v.fallback(v.string(), fallback), fallback);
}

function urlPicklist(options: readonly string[], fallback: string) {
	return v.optional(v.fallback(v.picklist(options), fallback), fallback);
}

/**
 * Build the URL schema of a cursor table: the canonical search, sort, page,
 * page size and cursor params plus the table's filters. Missing or invalid
 * values fall back to their defaults, and a page size outside `pageSizes`
 * falls back to `defaultPageSize`.
 */
export function createTableUrlSchema<
	const TFilters extends Record<string, TableUrlFilter>
>(options: { filters: TFilters; pageSizes: readonly number[]; defaultPageSize: number }) {
	const filterEntries = Object.fromEntries(
		Object.entries(options.filters).map(([key, filter]) => [
			key,
			filter === 'text' ? urlText('') : urlPicklist(filter, filter[0])
		])
	);
	const schema = v.object({
		search: urlText(''),
		...filterEntries,
		sort: urlText(''),
		page: urlText('1'),
		page_size: urlPicklist(options.pageSizes.map(String), String(options.defaultPageSize)),
		cursor: urlText('')
	});
	return schema as v.GenericSchema<unknown, CanonicalTableUrlState & TableUrlFilterState<TFilters>>;
}
