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
