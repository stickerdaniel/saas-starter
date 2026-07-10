/**
 * Pure helpers for the audit-log free-text search path. Kept out of queries.ts
 * (which registers Convex functions at import time) so they can be unit-tested
 * without the Convex function runtime.
 */

/** The two user references every audit row carries. */
export type AuditRowUsers = {
	adminUserId: string;
	targetUserId: string;
};

/**
 * Keep only rows whose admin OR target user id is in `matched`. Mirrors the
 * users-table search semantics: a row surfaces when either participant matches
 * the search string. An empty match set drops everything (a search that
 * resolved to no users returns no rows).
 */
export function filterAuditRowsByMatch<T extends AuditRowUsers>(
	rows: T[],
	matched: Set<string>
): T[] {
	if (matched.size === 0) return [];
	return rows.filter((row) => matched.has(row.adminUserId) || matched.has(row.targetUserId));
}

/**
 * Parse a table-kit offset cursor ("12" → 12), defaulting to 0 for a missing
 * or malformed value. The audit-log search path uses opaque numeric-offset
 * cursors (String(pageEnd)), matching the users table's search pagination.
 */
export function parseOffsetCursor(cursor: string | undefined): number {
	if (!cursor) return 0;
	const parsed = Number.parseInt(cursor, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Offset-slice a filtered row list into one page and produce the table-kit
 * cursor contract: `continueCursor` is the next offset as a string (null once
 * the slice reaches the end) and `isDone` is true on the last page.
 */
export function sliceAuditPage<T>(
	rows: T[],
	offset: number,
	numItems: number
): { pageRows: T[]; continueCursor: string | null; isDone: boolean } {
	const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;
	const pageEnd = safeOffset + numItems;
	const pageRows = rows.slice(safeOffset, pageEnd);
	const isDone = pageEnd >= rows.length;
	return {
		pageRows,
		continueCursor: isDone ? null : String(pageEnd),
		isDone
	};
}
