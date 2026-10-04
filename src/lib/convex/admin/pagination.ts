/**
 * Offset pagination shared by the admin list queries that filter or sort in
 * memory (users search/provider paths, notification recipients, audit-log
 * search). Their cursors are opaque numeric offsets (String(pageEnd)). Native
 * adapter cursors and the audit indexed cursors do not go through here.
 */

const DEFAULT_PAGE_SIZE = 10;

/**
 * Parse a table-kit offset cursor ("12" → 12), defaulting to 0 for a missing
 * or malformed value.
 */
function parseOffsetCursor(cursor: string | undefined): number {
	if (!cursor) return 0;
	const parsed = Number.parseInt(cursor, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Offset-slice a filtered row list into one page and produce the table-kit
 * cursor contract: `continueCursor` is the next offset as a string (null once
 * the slice reaches the end) and `isDone` is true on the last page.
 */
export function sliceOffsetPage<T>(
	rows: T[],
	cursor: string | undefined,
	numItems: number
): { items: T[]; continueCursor: string | null; isDone: boolean } {
	const offset = parseOffsetCursor(cursor);
	const pageEnd = offset + numItems;
	const isDone = pageEnd >= rows.length;
	return {
		items: rows.slice(offset, pageEnd),
		continueCursor: isDone ? null : String(pageEnd),
		isDone
	};
}

/**
 * Resolve the 1-indexed last page for `total` rows and the offset cursor that
 * fetches it (null when the last page is the first one). A missing or
 * non-positive page size falls back to 10.
 */
export function resolveOffsetLastPage(
	total: number,
	numItems: number
): { page: number; cursor: string | null } {
	if (total <= 0) return { page: 1, cursor: null };
	const pageSize = Number.isFinite(numItems) && numItems > 0 ? numItems : DEFAULT_PAGE_SIZE;
	const page = Math.max(1, Math.ceil(total / pageSize));
	const offset = (page - 1) * pageSize;
	return offset > 0 ? { page, cursor: String(offset) } : { page: 1, cursor: null };
}
