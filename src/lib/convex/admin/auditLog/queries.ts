import { v, type Infer } from 'convex/values';
import { components } from '../../_generated/api';
import type { QueryCtx } from '../../_generated/server';
import { adminQuery } from '../../functions';
import type { BetterAuthUser } from '../types';

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
 */
const auditLogMetadataValidator = v.optional(
	v.union(
		v.object({ reason: v.string() }), // ban_user, unban_user
		v.object({ newRole: v.string(), previousRole: v.string() }), // set_role
		v.object({}) // impersonate, stop_impersonation, revoke_sessions
	)
);

/**
 * A resolved user reference for an audit log row. The raw Better Auth id is
 * always present; name/email are filled only while the user still exists.
 * `exists: false` means the user was deleted after the action was logged, but
 * the id stays available so the UI can still reference the original actor/target.
 */
const auditLogUserRefValidator = v.object({
	id: v.string(),
	name: v.optional(v.string()),
	email: v.optional(v.string()),
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
 * Shared filter args. The UI sends at most one filter at a time; see
 * {@link queryAuditLogs} for how a single index is chosen from them.
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
 * Pick the single most selective index for the given filter and return the
 * newest-first ordered query.
 *
 * Filters are treated as mutually exclusive: the UI sends at most one of
 * actionFilter, adminUserId, or targetUserId, so we choose exactly one index
 * and do NOT apply the remaining filters as extra conditions (v1). Priority if
 * several are somehow set: action -> admin -> target -> unfiltered
 * (by_timestamp). For the single-value index branches, ordering by the index
 * resolves to `_creationTime desc` within the pinned value, which matches the
 * `timestamp` insertion order used by the writers in admin/mutations.ts.
 */
function queryAuditLogs(ctx: QueryCtx, filters: AuditLogFilters) {
	if (filters.actionFilter !== undefined) {
		const action = filters.actionFilter;
		return ctx.db
			.query('adminAuditLogs')
			.withIndex('by_action', (q) => q.eq('action', action))
			.order('desc');
	}
	if (filters.adminUserId !== undefined) {
		const adminUserId = filters.adminUserId;
		return ctx.db
			.query('adminAuditLogs')
			.withIndex('by_admin', (q) => q.eq('adminUserId', adminUserId))
			.order('desc');
	}
	if (filters.targetUserId !== undefined) {
		const targetUserId = filters.targetUserId;
		return ctx.db
			.query('adminAuditLogs')
			.withIndex('by_target', (q) => q.eq('targetUserId', targetUserId))
			.order('desc');
	}
	return ctx.db.query('adminAuditLogs').withIndex('by_timestamp').order('desc');
}

/**
 * Resolve a set of Better Auth user ids to { name, email }. Deleted users are
 * simply absent from the returned map. Lookups are bounded by page size: a page
 * holds at most `2 * numItems` unique ids (admin + target), each resolved with
 * a single point read, so this never scans the user table.
 */
async function resolveUsers(
	ctx: QueryCtx,
	ids: Set<string>
): Promise<Map<string, { name?: string; email?: string }>> {
	const resolved = new Map<string, { name?: string; email?: string }>();
	for (const id of ids) {
		const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: '_id', operator: 'eq', value: id }]
		})) as BetterAuthUser | null;
		if (user) {
			resolved.set(id, { name: user.name, email: user.email });
		}
	}
	return resolved;
}

function toUserRef(
	id: string,
	resolved: Map<string, { name?: string; email?: string }>
): Infer<typeof auditLogUserRefValidator> {
	const info = resolved.get(id);
	if (!info) {
		return { id, exists: false };
	}
	return { id, name: info.name, email: info.email, exists: true };
}

/**
 * List admin audit log entries, newest first, with cursor pagination.
 *
 * Backend half of the project table-kit contract: returns
 * `{ items, continueCursor, isDone }` where `continueCursor` is null exactly
 * when `isDone` is true. Each page is enriched with the admin/target user
 * details (bounded by page size, see {@link resolveUsers}).
 */
export const listAuditLogs = adminQuery({
	args: {
		cursor: v.optional(v.string()),
		numItems: v.number(),
		...auditLogFilterArgs
	},
	returns: v.object({
		items: v.array(auditLogItemValidator),
		continueCursor: v.union(v.string(), v.null()),
		isDone: v.boolean()
	}),
	handler: async (ctx, args) => {
		const result = await queryAuditLogs(ctx, args).paginate({
			numItems: args.numItems,
			cursor: args.cursor ?? null
		});

		const ids = new Set<string>();
		for (const row of result.page) {
			ids.add(row.adminUserId);
			ids.add(row.targetUserId);
		}
		const resolved = await resolveUsers(ctx, ids);

		const items = result.page.map((row) => ({
			id: row._id,
			action: row.action,
			timestamp: row.timestamp,
			metadata: row.metadata,
			admin: toUserRef(row.adminUserId, resolved),
			target: toUserRef(row.targetUserId, resolved)
		}));

		return {
			items,
			continueCursor: result.isDone ? null : result.continueCursor,
			isDone: result.isDone
		};
	}
});

/**
 * Count audit log entries matching the same (mutually exclusive) filter as
 * {@link listAuditLogs}. Count half of the table-kit contract.
 *
 * Capped at 5001 via .take() — this is a template-scale table, so we avoid an
 * unbounded .collect(). A returned 5001 means "5000+"; the UI can render a
 * "5000+" indicator if it ever reaches the cap.
 */
export const getAuditLogCount = adminQuery({
	args: auditLogFilterArgs,
	returns: v.number(),
	handler: async (ctx, args) => {
		const rows = await queryAuditLogs(ctx, args).take(5001);
		return rows.length;
	}
});

/**
 * Resolve the last page for the audit log table in one server call, so the
 * table-kit "jump to last page" action does not have to walk cursors from the
 * client. Same mutually-exclusive filter semantics as {@link listAuditLogs}
 * (reuses {@link queryAuditLogs}).
 *
 * Returns the 1-indexed last page and the cursor that fetches it (null for a
 * single-page result), matching the { page, cursor } contract of
 * resolveUsersLastPage and resolveNotificationRecipientsLastPage.
 *
 * The walk is bounded to ceil(5001 / numItems) pages, mirroring the 5001-row
 * cap in getAuditLogCount: on a table larger than that it lands on the capped
 * last page instead of scanning unbounded. Native Convex cursors are
 * position-based, so re-fetching a page with the recorded cursor is stable.
 */
export const resolveAuditLogLastPage = adminQuery({
	args: {
		numItems: v.number(),
		...auditLogFilterArgs
	},
	returns: v.object({
		page: v.number(),
		cursor: v.union(v.string(), v.null())
	}),
	handler: async (ctx, args): Promise<{ page: number; cursor: string | null }> => {
		const pageSize = Number.isFinite(args.numItems) && args.numItems > 0 ? args.numItems : 10;
		const maxPages = Math.ceil(5001 / pageSize);

		// Cursor that fetches the page currently being read (null for page 0).
		let cursor: string | null = null;
		let index = 0;
		let lastNonEmptyIndex = 0;
		let lastNonEmptyCursor: string | null = null;
		let found = false;

		for (let step = 0; step < maxPages; step++) {
			const result = await queryAuditLogs(ctx, args).paginate({ numItems: pageSize, cursor });

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
