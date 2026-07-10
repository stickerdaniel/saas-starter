import { v, type Infer } from 'convex/values';
import { components } from '../../_generated/api';
import type { Doc } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { adminQuery } from '../../functions';
import type { BetterAuthUser } from '../types';
import { collectMatchingUserIds } from '../userSearch';
import { filterAuditRowsByMatch, parseOffsetCursor, sliceAuditPage } from './search';

/**
 * The six admin actions recorded in the adminAuditLogs table.
 * Mirrors the `action` union in schema.ts. Exported so the frontend can build
 * the action filter without redeclaring the literals.
 */
export const auditLogActionValidator = v.union(
	v.literal('impersonate'),
	v.literal('stop_impersonation'),
	v.literal('ban_user'),
	v.literal('unban_user'),
	v.literal('revoke_sessions'),
	v.literal('set_role')
);

/**
 * Typed metadata per action, mirroring the schema's optional metadata union.
 * Exported so `queries.test.ts` can assert it stays structurally in sync with
 * the same union declared in schema.ts (the two must never drift apart).
 */
export const auditLogMetadataValidator = v.optional(
	v.union(
		v.object({ reason: v.string() }), // ban_user, unban_user
		v.object({ newRole: v.string(), previousRole: v.string() }), // set_role
		v.object({ durationMs: v.number() }), // stop_impersonation
		v.object({}) // impersonate, revoke_sessions
	)
);

/**
 * A resolved user reference for an audit log row. The raw Better Auth id is
 * always present; name/email/image are filled only while the user still exists.
 * `exists: false` means the user was deleted after the action was logged, but
 * the id stays available so the UI can still reference the original actor/target.
 */
const auditLogUserRefValidator = v.object({
	id: v.string(),
	name: v.optional(v.string()),
	email: v.optional(v.string()),
	image: v.optional(v.string()),
	exists: v.boolean()
});

/**
 * Full item shape returned by `listAuditLogs`. The frontend imports this
 * validator (or the inferred {@link AuditLogItem} type) to render the table.
 */
export const auditLogItemValidator = v.object({
	id: v.string(), // adminAuditLogs document _id
	action: auditLogActionValidator,
	timestamp: v.number(),
	metadata: auditLogMetadataValidator,
	admin: auditLogUserRefValidator,
	target: auditLogUserRefValidator
});

export type AuditLogItem = Infer<typeof auditLogItemValidator>;

/**
 * Shared filter args. The action filter combines with one user filter (admin or
 * target); the two user filters stay mutually exclusive. See {@link queryAuditLogs}
 * for how an index is chosen from them.
 */
const auditLogFilterArgs = {
	actionFilter: v.optional(auditLogActionValidator),
	adminUserId: v.optional(v.string()),
	targetUserId: v.optional(v.string())
};

type AuditLogFilters = {
	actionFilter?: Infer<typeof auditLogActionValidator>;
	adminUserId?: string;
	targetUserId?: string;
};

/**
 * Sort configuration for the audit log table. Only the timestamp column is
 * sortable; the UI flips between newest-first and oldest-first. Direction
 * defaults to 'desc' (newest first) when the arg is omitted.
 */
export const auditLogSortByValidator = v.object({
	field: v.literal('timestamp'),
	direction: v.union(v.literal('asc'), v.literal('desc'))
});

type AuditLogDirection = 'asc' | 'desc';

/**
 * Pick the most selective index for the given filter and return the query
 * ordered by `direction` (defaults to newest-first).
 *
 * The action filter combines with one user filter: actionFilter can be paired
 * with either adminUserId or targetUserId, served by the compound indexes
 * by_admin_action / by_target_action. The two user filters stay mutually
 * exclusive (the UI never sets both). Priority: admin+action -> target+action
 * -> action -> admin -> target -> unfiltered (by_timestamp).
 *
 * The single-filter indexes by_admin / by_target must NOT be dropped in favor
 * of the compound ones: with only one equality field pinned, a compound index
 * orders by (action, _creationTime) instead of purely by time, so the log rows
 * would sort by action first rather than newest-first. Within each branch,
 * ordering by the chosen index resolves to `_creationTime` after the pinned
 * fields, which matches the `timestamp` insertion order used by the writers in
 * admin/mutations.ts.
 */
function queryAuditLogs(
	ctx: QueryCtx,
	filters: AuditLogFilters,
	direction: AuditLogDirection = 'desc'
) {
	if (filters.adminUserId !== undefined && filters.actionFilter !== undefined) {
		const adminUserId = filters.adminUserId;
		const action = filters.actionFilter;
		return ctx.db
			.query('adminAuditLogs')
			.withIndex('by_admin_action', (q) => q.eq('adminUserId', adminUserId).eq('action', action))
			.order(direction);
	}
	if (filters.targetUserId !== undefined && filters.actionFilter !== undefined) {
		const targetUserId = filters.targetUserId;
		const action = filters.actionFilter;
		return ctx.db
			.query('adminAuditLogs')
			.withIndex('by_target_action', (q) => q.eq('targetUserId', targetUserId).eq('action', action))
			.order(direction);
	}
	if (filters.actionFilter !== undefined) {
		const action = filters.actionFilter;
		return ctx.db
			.query('adminAuditLogs')
			.withIndex('by_action', (q) => q.eq('action', action))
			.order(direction);
	}
	if (filters.adminUserId !== undefined) {
		const adminUserId = filters.adminUserId;
		return ctx.db
			.query('adminAuditLogs')
			.withIndex('by_admin', (q) => q.eq('adminUserId', adminUserId))
			.order(direction);
	}
	if (filters.targetUserId !== undefined) {
		const targetUserId = filters.targetUserId;
		return ctx.db
			.query('adminAuditLogs')
			.withIndex('by_target', (q) => q.eq('targetUserId', targetUserId))
			.order(direction);
	}
	return ctx.db.query('adminAuditLogs').withIndex('by_timestamp').order(direction);
}

/**
 * Resolve a set of Better Auth user ids to { name, email, image }. Deleted
 * users are simply absent from the returned map. Lookups are bounded by page
 * size: a page holds at most `2 * numItems` unique ids (admin + target), each
 * resolved with a single point read, so this never scans the user table.
 */
async function resolveUsers(
	ctx: QueryCtx,
	ids: Set<string>
): Promise<Map<string, { name?: string; email?: string; image?: string }>> {
	const resolved = new Map<string, { name?: string; email?: string; image?: string }>();
	for (const id of ids) {
		const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: '_id', operator: 'eq', value: id }]
		})) as BetterAuthUser | null;
		if (user) {
			resolved.set(id, { name: user.name, email: user.email, image: user.image ?? undefined });
		}
	}
	return resolved;
}

function toUserRef(
	id: string,
	resolved: Map<string, { name?: string; email?: string; image?: string }>
): Infer<typeof auditLogUserRefValidator> {
	const info = resolved.get(id);
	if (!info) {
		return { id, exists: false };
	}
	return { id, name: info.name, email: info.email, image: info.image, exists: true };
}

/**
 * Resolve and shape a batch of audit rows into the {@link auditLogItemValidator}
 * item shape returned to the client. Shared by both the cursor path and the
 * search path so the row mapping stays in one place. Enrichment is bounded by
 * batch size (see {@link resolveUsers}).
 */
async function enrichAuditRows(
	ctx: QueryCtx,
	rows: Array<Doc<'adminAuditLogs'>>
): Promise<Array<Infer<typeof auditLogItemValidator>>> {
	const ids = new Set<string>();
	for (const row of rows) {
		ids.add(row.adminUserId);
		ids.add(row.targetUserId);
	}
	const resolved = await resolveUsers(ctx, ids);
	return rows.map((row) => ({
		id: row._id,
		action: row.action,
		timestamp: row.timestamp,
		metadata: row.metadata,
		admin: toUserRef(row.adminUserId, resolved),
		target: toUserRef(row.targetUserId, resolved)
	}));
}

/**
 * Search path for the audit log: resolve the search string to a set of matching
 * user ids (same semantics as the users table, see {@link collectMatchingUserIds}),
 * then scan the log — respecting the action filter — and keep rows whose admin
 * OR target user is in that set.
 *
 * Bounded scan: capped at 5001 rows via .take(), the same cap as
 * {@link getAuditLogCount}, so the search path never runs an unbounded
 * .collect() on a template-scale table (a full 5001 means "5000+"). List and
 * count share this function so their totals stay consistent.
 *
 * The two user filters (adminUserId / targetUserId) are intentionally ignored
 * here: the UI clears them whenever a search is active (they are mutually
 * exclusive with search), so only the action filter can co-exist with it.
 */
async function scanMatchingAuditRows(
	ctx: QueryCtx,
	args: { search?: string; actionFilter?: Infer<typeof auditLogActionValidator> },
	direction: AuditLogDirection = 'desc'
): Promise<Array<Doc<'adminAuditLogs'>>> {
	const matched = await collectMatchingUserIds(ctx, args.search);
	if (matched.size === 0) return [];
	const rows = await queryAuditLogs(ctx, { actionFilter: args.actionFilter }, direction).take(5001);
	return filterAuditRowsByMatch(rows, matched);
}

/**
 * List admin audit log entries, newest first, with cursor pagination.
 *
 * Backend half of the project table-kit contract: returns
 * `{ items, continueCursor, isDone }` where `continueCursor` is null exactly
 * when `isDone` is true. Each page is enriched with the admin/target user
 * details (bounded by page size, see {@link resolveUsers}).
 *
 * A `search` string switches to the enumerate-and-offset path
 * ({@link scanMatchingAuditRows}): the Better Auth component has no search index,
 * so the log is scanned and filtered to rows whose admin/target matches, then
 * sliced by an opaque numeric-offset cursor (String(pageEnd)) — the same
 * mechanism the users table uses for its search.
 */
export const listAuditLogs = adminQuery({
	args: {
		cursor: v.optional(v.string()),
		numItems: v.number(),
		search: v.optional(v.string()),
		sortBy: v.optional(auditLogSortByValidator),
		...auditLogFilterArgs
	},
	returns: v.object({
		items: v.array(auditLogItemValidator),
		continueCursor: v.union(v.string(), v.null()),
		isDone: v.boolean()
	}),
	handler: async (ctx, args) => {
		const direction = args.sortBy?.direction ?? 'desc';

		if (args.search?.trim()) {
			const matchingRows = await scanMatchingAuditRows(ctx, args, direction);
			const { pageRows, continueCursor, isDone } = sliceAuditPage(
				matchingRows,
				parseOffsetCursor(args.cursor),
				args.numItems
			);
			return {
				items: await enrichAuditRows(ctx, pageRows),
				continueCursor,
				isDone
			};
		}

		const result = await queryAuditLogs(ctx, args, direction).paginate({
			numItems: args.numItems,
			cursor: args.cursor ?? null
		});

		return {
			items: await enrichAuditRows(ctx, result.page),
			continueCursor: result.isDone ? null : result.continueCursor,
			isDone: result.isDone
		};
	}
});

/**
 * Resolve a single Better Auth user id to the same {@link auditLogUserRefValidator}
 * shape the table cells use. Powers the deep-linked filter chip: when the page
 * loads with `?admin=<id>` / `?target=<id>` the name is not in any visible row,
 * so the chip resolves it here. A single point read (see {@link resolveUsers}),
 * `exists: false` (id echoed back) for a user deleted after the action was logged.
 */
export const resolveAuditLogUser = adminQuery({
	args: { userId: v.string() },
	returns: auditLogUserRefValidator,
	handler: async (ctx, args) => {
		const resolved = await resolveUsers(ctx, new Set([args.userId]));
		return toUserRef(args.userId, resolved);
	}
});

/**
 * Count audit log entries matching the same filter as {@link listAuditLogs}.
 * Count half of the table-kit contract.
 *
 * Capped at 5001 via .take() — this is a template-scale table, so we avoid an
 * unbounded .collect(). A returned 5001 means "5000+"; the UI can render a
 * "5000+" indicator if it ever reaches the cap.
 *
 * A `search` string counts via the same scan+filter as {@link listAuditLogs}
 * (shared {@link scanMatchingAuditRows}), so the footer total stays consistent
 * with the rows shown.
 */
export const getAuditLogCount = adminQuery({
	args: {
		search: v.optional(v.string()),
		...auditLogFilterArgs
	},
	returns: v.number(),
	handler: async (ctx, args) => {
		if (args.search?.trim()) {
			const matchingRows = await scanMatchingAuditRows(ctx, args);
			return matchingRows.length;
		}
		const rows = await queryAuditLogs(ctx, args).take(5001);
		return rows.length;
	}
});

/**
 * Resolve the last page for the audit log table in one server call, so the
 * table-kit "jump to last page" action does not have to walk cursors from the
 * client. Same filter semantics as {@link listAuditLogs} (reuses
 * {@link queryAuditLogs}).
 *
 * Returns the 1-indexed last page and the cursor that fetches it (null for a
 * single-page result), matching the { page, cursor } contract of
 * resolveUsersLastPage and resolveNotificationRecipientsLastPage.
 *
 * The walk is bounded to ceil(5001 / numItems) pages, mirroring the 5001-row
 * cap in getAuditLogCount: on a table larger than that it lands on the capped
 * last page instead of scanning unbounded. Native Convex cursors are
 * position-based, so re-fetching a page with the recorded cursor is stable.
 *
 * A `search` string resolves the last page from the scanned-and-filtered row
 * count directly (offset math, like resolveUsersLastPage), since the search
 * path paginates by numeric offset rather than native cursors.
 */
export const resolveAuditLogLastPage = adminQuery({
	args: {
		numItems: v.number(),
		search: v.optional(v.string()),
		sortBy: v.optional(auditLogSortByValidator),
		...auditLogFilterArgs
	},
	returns: v.object({
		page: v.number(),
		cursor: v.union(v.string(), v.null())
	}),
	handler: async (ctx, args): Promise<{ page: number; cursor: string | null }> => {
		const direction = args.sortBy?.direction ?? 'desc';
		const pageSize = Number.isFinite(args.numItems) && args.numItems > 0 ? args.numItems : 10;

		if (args.search?.trim()) {
			const total = (await scanMatchingAuditRows(ctx, args, direction)).length;
			if (total <= 0) {
				return { page: 1, cursor: null };
			}
			const lastPage = Math.max(1, Math.ceil(total / pageSize));
			const targetOffset = (lastPage - 1) * pageSize;
			if (targetOffset <= 0) {
				return { page: 1, cursor: null };
			}
			return { page: lastPage, cursor: String(targetOffset) };
		}

		const maxPages = Math.ceil(5001 / pageSize);

		// Cursor that fetches the page currently being read (null for page 0).
		let cursor: string | null = null;
		let index = 0;
		let lastNonEmptyIndex = 0;
		let lastNonEmptyCursor: string | null = null;
		let found = false;

		for (let step = 0; step < maxPages; step++) {
			const result = await queryAuditLogs(ctx, args, direction).paginate({
				numItems: pageSize,
				cursor
			});

			if (result.page.length > 0) {
				lastNonEmptyIndex = index;
				lastNonEmptyCursor = cursor;
				found = true;
			}

			if (result.isDone || !result.continueCursor) break;

			cursor = result.continueCursor;
			index++;
		}

		if (!found) {
			return { page: 1, cursor: null };
		}

		return { page: lastNonEmptyIndex + 1, cursor: lastNonEmptyCursor };
	}
});
