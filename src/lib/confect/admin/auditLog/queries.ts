import { paginator } from 'convex-helpers/server/pagination';
import schema from '../../../convex/schema';
import { components } from '../../../convex/_generated/api';
import type { Doc } from '../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../convex/_generated/server';
import type { BetterAuthUser } from '../types';
import { collectMatchingUserIds } from '../userSearch';
import { resolveOffsetLastPage, sliceOffsetPage } from '../pagination';
import type {
	AuditLogActionSchema,
	AuditLogCountArgsSchema,
	AuditLogItemSchema,
	AuditLogLastPageArgsSchema,
	AuditLogUserRefSchema,
	ListAuditLogsArgsSchema
} from './schemas';
import { filterAuditRowsByMatch } from './search';

export type AuditLogItem = typeof AuditLogItemSchema.Type;
type AuditLogAction = typeof AuditLogActionSchema.Type;
type AuditLogUserRef = typeof AuditLogUserRefSchema.Type;

type AuditLogFilters = {
	actionFilter?: AuditLogAction;
	adminUserId?: string;
	targetUserId?: string;
};

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
): AuditLogUserRef {
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
): Promise<AuditLogItem[]> {
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
 * The scan stops at 5001 rows, the cap of {@link countAuditLogs}, and a full
 * 5001 means "5000+". List and count share this function so their totals agree.
 *
 * The user filters are ignored here, because the UI clears them while a search
 * is active.
 */
async function scanMatchingAuditRows(
	ctx: QueryCtx,
	args: { search?: string; actionFilter?: AuditLogAction },
	direction: AuditLogDirection = 'desc'
): Promise<Array<Doc<'adminAuditLogs'>>> {
	const matched = await collectMatchingUserIds(ctx, args.search);
	if (matched.size === 0) return [];
	const rows = await queryAuditLogs(ctx, { actionFilter: args.actionFilter }, direction).take(5001);
	return filterAuditRowsByMatch(rows, matched);
}

export async function readAuditLogPage(
	ctx: QueryCtx,
	args: typeof ListAuditLogsArgsSchema.Type
): Promise<{ items: AuditLogItem[]; continueCursor: string | null; isDone: boolean }> {
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

	const indexed = !args.cursor || args.cursor.startsWith(INDEX_CURSOR_PREFIX);
	const result = await queryAuditLogs(ctx, args, direction, indexed).paginate({
		numItems: args.numItems,
		cursor: indexed
			? (args.cursor?.slice(INDEX_CURSOR_PREFIX.length) ?? null)
			: (args.cursor ?? null)
	});
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

export async function resolveAuditLogUserRef(
	ctx: QueryCtx,
	userId: string
): Promise<AuditLogUserRef> {
	const resolved = await resolveUsers(ctx, new Set([userId]));
	return toUserRef(userId, resolved);
}

export async function countAuditLogs(
	ctx: QueryCtx,
	args: typeof AuditLogCountArgsSchema.Type
): Promise<number> {
	if (args.search?.trim()) {
		const matchingRows = await scanMatchingAuditRows(ctx, args);
		return matchingRows.length;
	}
	const rows = await queryAuditLogs(ctx, args).take(5001);
	return rows.length;
}

export async function findAuditLogLastPage(
	ctx: QueryCtx,
	args: typeof AuditLogLastPageArgsSchema.Type
): Promise<{ page: number; cursor: string | null }> {
	const direction = args.sortBy?.direction ?? 'desc';
	const pageSize = Number.isFinite(args.numItems) && args.numItems > 0 ? args.numItems : 10;

	if (args.search?.trim()) {
		const total = (await scanMatchingAuditRows(ctx, args, direction)).length;
		return resolveOffsetLastPage(total, args.numItems);
	}

	const maxPages = Math.ceil(5001 / pageSize);

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
