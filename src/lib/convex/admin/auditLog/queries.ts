import { v, type Infer } from 'convex/values';
import { paginator } from 'convex-helpers/server/pagination';
import schema from '../../schema';
import { components } from '../../_generated/api';
import type { Doc } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { adminQuery } from '../../../confect/functions';
import type { BetterAuthUser } from '../../../confect/admin/types';
import { collectMatchingUserIds } from '../../../confect/admin/userSearch';
import { resolveOffsetLastPage, sliceOffsetPage } from '../../../confect/admin/pagination';
import { filterAuditRowsByMatch } from '../../../confect/admin/auditLog/search';

/**
 * Mirrors the `action` union of adminAuditLogs in schema.ts. The frontend builds
 * its action filter from it.
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
 * Mirrors the metadata union in schema.ts. `queries.test.ts` asserts that the two
 * stay structurally equal.
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
 * A user reference of an audit log row. The Better Auth id is always present.
 * Name, email, and image are filled only while the user still exists.
 * `exists: false` marks a user deleted after the action was logged.
 */
const auditLogUserRefValidator = v.object({
	id: v.string(),
	name: v.optional(v.string()),
	email: v.optional(v.string()),
	image: v.optional(v.string()),
	exists: v.boolean()
});

/** Item shape of `listAuditLogs`. The frontend table renders {@link AuditLogItem}. */
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
 * Only the timestamp column is sortable. An omitted sort means 'desc', newest
 * first.
 */
export const auditLogSortByValidator = v.object({
	field: v.literal('timestamp'),
	direction: v.union(v.literal('asc'), v.literal('desc'))
});

type AuditLogDirection = 'asc' | 'desc';

const INDEX_CURSOR_PREFIX = 'audit:v1:';

/**
 * Picks the most selective index for the filters and orders by `direction`.
 *
 * The two user filters are mutually exclusive, because the UI never sets both.
 * Priority: admin+action, target+action, action, admin, target, then
 * by_timestamp.
 *
 * The single-filter indexes by_admin and by_target must stay. With one equality
 * field pinned, a compound index orders by (action, _creationTime), so the rows
 * would sort by action before time. Within each branch the index order resolves
 * to `_creationTime` after the pinned fields, which matches the `timestamp`
 * insertion order of the writers in admin/mutations.ts.
 */
function queryAuditLogs(
	ctx: QueryCtx,
	filters: AuditLogFilters,
	direction: AuditLogDirection = 'desc',
	indexed = false
) {
	const db = indexed ? paginator(ctx.db, schema) : ctx.db;
	if (filters.adminUserId !== undefined && filters.actionFilter !== undefined) {
		const adminUserId = filters.adminUserId;
		const action = filters.actionFilter;
		return db
			.query('adminAuditLogs')
			.withIndex('by_admin_action', (q) => q.eq('adminUserId', adminUserId).eq('action', action))
			.order(direction);
	}
	if (filters.targetUserId !== undefined && filters.actionFilter !== undefined) {
		const targetUserId = filters.targetUserId;
		const action = filters.actionFilter;
		return db
			.query('adminAuditLogs')
			.withIndex('by_target_action', (q) => q.eq('targetUserId', targetUserId).eq('action', action))
			.order(direction);
	}
	if (filters.actionFilter !== undefined) {
		const action = filters.actionFilter;
		return db
			.query('adminAuditLogs')
			.withIndex('by_action', (q) => q.eq('action', action))
			.order(direction);
	}
	if (filters.adminUserId !== undefined) {
		const adminUserId = filters.adminUserId;
		return db
			.query('adminAuditLogs')
			.withIndex('by_admin', (q) => q.eq('adminUserId', adminUserId))
			.order(direction);
	}
	if (filters.targetUserId !== undefined) {
		const targetUserId = filters.targetUserId;
		return db
			.query('adminAuditLogs')
			.withIndex('by_target', (q) => q.eq('targetUserId', targetUserId))
			.order(direction);
	}
	return db.query('adminAuditLogs').withIndex('by_timestamp').order(direction);
}

/**
 * Resolves Better Auth user ids. Deleted users are absent from the map. A page
 * holds at most `2 * numItems` unique ids (admin and target), and the adapter
 * resolves `_id in` with point reads.
 */
async function resolveUsers(
	ctx: QueryCtx,
	ids: Set<string>
): Promise<Map<string, { name?: string; email?: string; image?: string }>> {
	const resolved = new Map<string, { name?: string; email?: string; image?: string }>();
	if (ids.size === 0) return resolved;
	const users = await ctx.runQuery(components.betterAuth.adapter.findMany, {
		model: 'user',
		where: [{ field: '_id', operator: 'in', value: [...ids] }],
		paginationOpts: { cursor: null, numItems: ids.size },
		select: ['_id', 'name', 'email', 'image']
	});
	for (const user of users.page as BetterAuthUser[]) {
		resolved.set(user._id, { name: user.name, email: user.email, image: user.image ?? undefined });
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

/** User lookups are bounded by the batch size (see {@link resolveUsers}). */
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
 * Search path: resolves the search string to matching user ids with the users
 * table's semantics ({@link collectMatchingUserIds}). It then scans the log
 * under the action filter and keeps rows whose admin or target is in that set.
 *
 * The scan stops at 5001 rows, the cap of {@link getAuditLogCount}, and a full
 * 5001 means "5000+". List and count share this function so their totals agree.
 *
 * The user filters are ignored here, because the UI clears them while a search
 * is active.
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
 * Backend half of the table-kit contract. `continueCursor` is null exactly when
 * `isDone` is true.
 *
 * A `search` string switches to {@link scanMatchingAuditRows}, because the Better
 * Auth component has no search index. The matching rows are sliced by an opaque
 * numeric-offset cursor, as in the users table search.
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
			const { items, continueCursor, isDone } = sliceOffsetPage(
				matchingRows,
				args.cursor,
				args.numItems
			);
			return {
				items: await enrichAuditRows(ctx, items),
				continueCursor,
				isDone
			};
		}

		// Continue native cursors held by clients from before the indexed-cursor rollout.
		const indexed = !args.cursor || args.cursor.startsWith(INDEX_CURSOR_PREFIX);
		const result = await queryAuditLogs(ctx, args, direction, indexed).paginate({
			numItems: args.numItems,
			cursor: indexed ? (args.cursor?.slice(INDEX_CURSOR_PREFIX.length) ?? null) : args.cursor!
		});
		// Helper pages stop at their requested size, including an exactly full final page.
		const isDone =
			indexed && !result.isDone
				? (
						await queryAuditLogs(ctx, args, direction, true).paginate({
							cursor: result.continueCursor,
							numItems: 1
						})
					).page.length === 0
				: result.isDone;

		return {
			items: await enrichAuditRows(ctx, result.page),
			continueCursor: isDone
				? null
				: indexed
					? INDEX_CURSOR_PREFIX + result.continueCursor
					: result.continueCursor,
			isDone
		};
	}
});

/**
 * Resolves one user id for the deep-linked filter chip. A page loaded with
 * `?admin=<id>` or `?target=<id>` may show no row that carries the name.
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
 * Count half of the table-kit contract, with the filters of {@link listAuditLogs}.
 *
 * The count stops at 5001 to stay bounded, and a returned 5001 means "5000+".
 * A `search` string counts through {@link scanMatchingAuditRows}, so the footer
 * total matches the rows shown.
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
 * Resolves the last page in one server call for the table-kit "jump to last
 * page" action, so the client walks no cursors.
 *
 * Returns the 1-indexed last page and the cursor that fetches it (null for a
 * single-page result). The { page, cursor } contract matches
 * resolveUsersLastPage and resolveNotificationRecipientsLastPage.
 *
 * The walk stops after ceil(5001 / numItems) pages, the 5001-row cap of
 * getAuditLogCount, and lands on the capped last page of a larger table.
 * Indexed cursors identify the last row of the preceding page, so one query can
 * walk them repeatedly.
 *
 * A `search` string computes the last page from the matching row count, because
 * the search path paginates by numeric offset.
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
			return resolveOffsetLastPage(total, args.numItems);
		}

		const maxPages = Math.ceil(5001 / pageSize);

		// Cursor that fetches the page currently being read (null for page 0).
		let cursor: string | null = null;
		let index = 0;
		let lastNonEmptyIndex = 0;
		let lastNonEmptyCursor: string | null = null;
		let found = false;
		let scanned = 0;

		for (let step = 0; step < maxPages; step++) {
			const result = await queryAuditLogs(ctx, args, direction, true).paginate({
				numItems: Math.min(pageSize, 5001 - scanned),
				cursor
			});

			scanned += result.page.length;

			if (result.page.length > 0) {
				lastNonEmptyIndex = index;
				lastNonEmptyCursor = cursor;
				found = true;
			}

			if (result.isDone || !result.continueCursor || scanned >= 5001) break;

			cursor = result.continueCursor;
			index++;
		}

		if (!found) {
			return { page: 1, cursor: null };
		}

		return {
			page: lastNonEmptyIndex + 1,
			cursor: lastNonEmptyCursor === null ? null : INDEX_CURSOR_PREFIX + lastNonEmptyCursor
		};
	}
});
