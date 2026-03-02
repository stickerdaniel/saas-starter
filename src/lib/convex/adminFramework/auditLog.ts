import { v } from 'convex/values';
import { permissionQuery, assertPermission } from './access';
import { runPaginatedListQuery } from './utils/resource_query';

export const listAuditLogs = permissionQuery({
	args: {
		cursor: v.optional(v.string()),
		numItems: v.number(),
		search: v.optional(v.string()),
		filters: v.optional(
			v.object({
				resourceName: v.optional(v.string()),
				event: v.optional(v.string()),
				adminUserId: v.optional(v.string())
			})
		)
	},
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const search = args.search?.trim();
		const filters = args.filters;

		if (search) {
			const paginated = await runPaginatedListQuery({
				query: ctx.db.query('adminResourceAuditLogs').withSearchIndex('search_audit', (q: any) => {
					let query = q.search('resourceName', search);
					if (filters?.event) query = query.eq('event', filters.event);
					if (filters?.adminUserId) query = query.eq('adminUserId', filters.adminUserId);
					return query;
				}),
				cursor: args.cursor,
				numItems: args.numItems
			});
			return {
				items: paginated.items,
				continueCursor: paginated.continueCursor,
				isDone: paginated.isDone
			};
		}

		// Filter by specific admin
		if (filters?.adminUserId) {
			const paginated = await runPaginatedListQuery({
				query: ctx.db
					.query('adminResourceAuditLogs')
					.withIndex('by_admin', (q: any) => q.eq('adminUserId', filters.adminUserId)),
				cursor: args.cursor,
				numItems: args.numItems,
				order: 'desc'
			});
			return {
				items: paginated.items,
				continueCursor: paginated.continueCursor,
				isDone: paginated.isDone
			};
		}

		// Filter by event type
		if (filters?.event) {
			const paginated = await runPaginatedListQuery({
				query: ctx.db
					.query('adminResourceAuditLogs')
					.withIndex('by_event', (q: any) => q.eq('event', filters.event)),
				cursor: args.cursor,
				numItems: args.numItems,
				order: 'desc'
			});
			return {
				items: paginated.items,
				continueCursor: paginated.continueCursor,
				isDone: paginated.isDone
			};
		}

		// Default: chronological descending
		const paginated = await runPaginatedListQuery({
			query: ctx.db.query('adminResourceAuditLogs').withIndex('by_timestamp'),
			cursor: args.cursor,
			numItems: args.numItems,
			order: 'desc'
		});
		return {
			items: paginated.items,
			continueCursor: paginated.continueCursor,
			isDone: paginated.isDone
		};
	}
});

export const countAuditLogs = permissionQuery({
	args: {
		search: v.optional(v.string()),
		filters: v.optional(
			v.object({
				resourceName: v.optional(v.string()),
				event: v.optional(v.string()),
				adminUserId: v.optional(v.string())
			})
		)
	},
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const search = args.search?.trim();
		const filters = args.filters;

		if (search) {
			const results = await ctx.db
				.query('adminResourceAuditLogs')
				.withSearchIndex('search_audit', (q: any) => {
					let query = q.search('resourceName', search);
					if (filters?.event) query = query.eq('event', filters.event);
					if (filters?.adminUserId) query = query.eq('adminUserId', filters.adminUserId);
					return query;
				})
				.collect();
			return results.length;
		}

		if (filters?.adminUserId) {
			const results = await ctx.db
				.query('adminResourceAuditLogs')
				.withIndex('by_admin', (q: any) => q.eq('adminUserId', filters.adminUserId))
				.collect();
			return results.length;
		}

		if (filters?.event) {
			const results = await ctx.db
				.query('adminResourceAuditLogs')
				.withIndex('by_event', (q: any) => q.eq('event', filters.event))
				.collect();
			return results.length;
		}

		const results = await ctx.db.query('adminResourceAuditLogs').collect();
		return results.length;
	}
});

export const getAuditLogsByRecord = permissionQuery({
	args: {
		resourceName: v.string(),
		resourceId: v.string(),
		cursor: v.optional(v.string()),
		numItems: v.number()
	},
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const paginated = await runPaginatedListQuery({
			query: ctx.db
				.query('adminResourceAuditLogs')
				.withIndex('by_resource', (q: any) =>
					q.eq('resourceName', args.resourceName).eq('resourceId', args.resourceId)
				),
			cursor: args.cursor,
			numItems: args.numItems,
			order: 'desc'
		});
		return {
			items: paginated.items,
			continueCursor: paginated.continueCursor,
			isDone: paginated.isDone
		};
	}
});

export const getAuditLogBatch = permissionQuery({
	args: { batchId: v.string() },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		return ctx.db
			.query('adminResourceAuditLogs')
			.withIndex('by_batch', (q: any) => q.eq('batchId', args.batchId))
			.collect();
	}
});
