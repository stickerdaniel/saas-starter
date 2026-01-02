import { v } from 'convex/values';
import { components } from '../../_generated/api';
import { paginationOptsValidator } from 'convex/server';
import { adminQuery } from '../../functions';
import { SUPPORT_THREADS_PAGE_SIZE, ADMIN_USERS_BATCH_SIZE } from './constants';
import { parseBetterAuthUsers, betterAuthUserSchema } from '../types';
import { isAnonymousUser } from '../../utils/anonymousUser';

/**
 * List threads with admin filters
 *
 * ARCHITECTURE: Queries supportThreads table with admin metadata.
 *
 * Supports filtering by:
 * - assignedTo (specific admin or null for unassigned)
 * - status (open, done)
 * - search (title, summary, or message content)
 *
 * Returns threads sorted by lastMessageAt (most recent first)
 */
export const listThreadsForAdmin = adminQuery({
	args: {
		filter: v.union(
			v.literal('all'),
			v.literal('unassigned'),
			v.object({ assignedTo: v.string() })
		),
		status: v.optional(v.union(v.literal('open'), v.literal('done'))),
		search: v.optional(v.string()),
		paginationOpts: v.optional(paginationOptsValidator)
	},
	returns: v.object({
		page: v.array(
			v.object({
				_id: v.string(),
				_creationTime: v.number(),
				userId: v.optional(v.string()),
				title: v.optional(v.string()),
				summary: v.optional(v.string()),
				status: v.union(v.literal('active'), v.literal('archived')),
				supportMetadata: v.object({
					_id: v.string(),
					_creationTime: v.number(),
					threadId: v.string(),
					userId: v.optional(v.string()),
					status: v.union(v.literal('open'), v.literal('done')),
					assignedTo: v.optional(v.string()),
					isHandedOff: v.optional(v.boolean()),
					priority: v.optional(v.union(v.literal('low'), v.literal('medium'), v.literal('high'))),
					pageUrl: v.optional(v.string()),
					notificationEmail: v.optional(v.string()),
					notificationSentAt: v.optional(v.number()),
					unreadByAdmin: v.boolean(),
					createdAt: v.number(),
					updatedAt: v.number(),
					// Denormalized search fields
					searchText: v.optional(v.string()),
					title: v.optional(v.string()),
					summary: v.optional(v.string()),
					lastMessage: v.optional(v.string()),
					userName: v.optional(v.string()),
					userEmail: v.optional(v.string())
				}),
				lastMessage: v.optional(v.string()),
				lastMessageAt: v.optional(v.number()),
				userName: v.optional(v.string()),
				userEmail: v.optional(v.string()),
				userImage: v.optional(v.string())
			})
		),
		isDone: v.boolean(),
		continueCursor: v.string()
	}),
	handler: async (ctx, args) => {
		const paginationOpts = args.paginationOpts ?? {
			numItems: SUPPORT_THREADS_PAGE_SIZE,
			cursor: null
		};

		let supportThreads;
		const isSearchActive = !!args.search?.trim();

		// Extract typed values for type-safe comparisons
		const statusFilter = args.status; // 'open' | 'done' | undefined
		const filterType = args.filter; // 'all' | 'unassigned' | { assignedTo: string }
		const assignedToFilter =
			typeof filterType === 'object' && 'assignedTo' in filterType
				? filterType.assignedTo
				: undefined;
		const isUnassigned = filterType === 'unassigned';

		// =========================================================================
		// QUERY PATH: Search vs Non-Search
		// =========================================================================
		if (isSearchActive) {
			// SEARCH PATH: Use chainable search filter builder
			const searchQuery = args.search!.trim();

			supportThreads = await ctx.db
				.query('supportThreads')
				.withSearchIndex('search_all', (q) => {
					let filter = q.search('searchText', searchQuery);
					if (statusFilter) filter = filter.eq('status', statusFilter);
					if (isUnassigned) filter = filter.eq('assignedTo', undefined);
					else if (assignedToFilter) filter = filter.eq('assignedTo', assignedToFilter);
					return filter;
				})
				.paginate(paginationOpts);
		} else {
			// NON-SEARCH PATH: Support combined status + assignment filtering
			if (statusFilter && (isUnassigned || assignedToFilter)) {
				// Combined: status + assignment (use compound index)
				supportThreads = await ctx.db
					.query('supportThreads')
					.withIndex('by_status_and_assigned', (q) =>
						q
							.eq('status', statusFilter)
							.eq('assignedTo', isUnassigned ? undefined : assignedToFilter)
					)
					.order('desc')
					.paginate(paginationOpts);
			} else if (statusFilter) {
				// Status only
				supportThreads = await ctx.db
					.query('supportThreads')
					.withIndex('by_status', (q) => q.eq('status', statusFilter))
					.order('desc')
					.paginate(paginationOpts);
			} else if (isUnassigned) {
				// Unassigned only (no status filter)
				supportThreads = await ctx.db
					.query('supportThreads')
					.withIndex('by_assigned', (q) => q.eq('assignedTo', undefined))
					.order('desc')
					.paginate(paginationOpts);
			} else if (assignedToFilter) {
				// Specific admin only (no status filter)
				supportThreads = await ctx.db
					.query('supportThreads')
					.withIndex('by_assigned', (q) => q.eq('assignedTo', assignedToFilter))
					.order('desc')
					.paginate(paginationOpts);
			} else {
				// No filters
				supportThreads = await ctx.db
					.query('supportThreads')
					.order('desc')
					.paginate(paginationOpts);
			}
		}

		// =========================================================================
		// ENRICHMENT: Get agent thread status (denormalized fields already available)
		// =========================================================================
		const threadsWithDetails = await Promise.all(
			supportThreads.page.map(async (supportThread) => {
				try {
					// Get agent thread (for status field - required by return type)
					const agentThread = await ctx.runQuery(components.agent.threads.getThread, {
						threadId: supportThread.threadId
					});

					if (!agentThread) {
						// Thread was deleted but supportThread still exists - skip it
						return null;
					}

					// Use denormalized fields from supportThread when available
					// Fall back to agent thread data for non-backfilled records
					return {
						_id: agentThread._id,
						_creationTime: agentThread._creationTime,
						userId: agentThread.userId,
						title: supportThread.title ?? agentThread.title,
						summary: supportThread.summary ?? agentThread.summary,
						status: agentThread.status,
						supportMetadata: supportThread,
						lastMessage: supportThread.lastMessage,
						lastMessageAt: supportThread.updatedAt ?? agentThread._creationTime,
						userName: supportThread.userName,
						userEmail: supportThread.userEmail
					};
				} catch (error) {
					console.error(
						`[listThreadsForAdmin] ❌ ERROR enriching thread ${supportThread.threadId}:`,
						error
					);
					return null;
				}
			})
		);

		// Filter out null entries (deleted threads)
		const validThreads = threadsWithDetails.filter((t): t is NonNullable<typeof t> => t !== null);

		// =========================================================================
		// ENRICHMENT: Batch fetch user images from Better Auth
		// =========================================================================
		const userIds = [
			...new Set(
				validThreads.map((t) => t.userId).filter((id): id is string => !!id && !isAnonymousUser(id))
			)
		];

		const userImageMap = new Map<string, string>();

		if (userIds.length > 0) {
			// Batch fetch users to get their images
			const usersResult = await ctx.runQuery(components.betterAuth.adapter.findMany, {
				model: 'user',
				paginationOpts: { cursor: null, numItems: userIds.length },
				where: []
			});

			// Build lookup map for user images
			for (const user of usersResult.page) {
				const parsed = betterAuthUserSchema.safeParse(user);
				if (parsed.success && userIds.includes(parsed.data._id) && parsed.data.image) {
					userImageMap.set(parsed.data._id, parsed.data.image);
				}
			}
		}

		// Add userImage to each thread
		const threadsWithImages = validThreads.map((thread) => ({
			...thread,
			userImage: thread.userId ? userImageMap.get(thread.userId) : undefined
		}));

		return {
			page: threadsWithImages,
			isDone: supportThreads.isDone,
			continueCursor: supportThreads.continueCursor
		};
	}
});

/**
 * Get thread details for admin view
 * Includes assignment, status, priority, and user info
 */
export const getThreadForAdmin = adminQuery({
	args: { threadId: v.string() },
	returns: v.object({
		_id: v.string(),
		_creationTime: v.number(),
		userId: v.optional(v.string()),
		title: v.optional(v.string()),
		summary: v.optional(v.string()),
		status: v.union(v.literal('active'), v.literal('archived')),
		supportMetadata: v.object({
			_id: v.string(),
			_creationTime: v.number(),
			threadId: v.string(),
			userId: v.optional(v.string()),
			status: v.union(v.literal('open'), v.literal('done')),
			assignedTo: v.optional(v.string()),
			isHandedOff: v.optional(v.boolean()),
			priority: v.optional(v.union(v.literal('low'), v.literal('medium'), v.literal('high'))),
			pageUrl: v.optional(v.string()),
			notificationEmail: v.optional(v.string()),
			notificationSentAt: v.optional(v.number()),
			unreadByAdmin: v.boolean(),
			createdAt: v.number(),
			updatedAt: v.number(),
			// Denormalized search fields
			searchText: v.optional(v.string()),
			title: v.optional(v.string()),
			summary: v.optional(v.string()),
			lastMessage: v.optional(v.string()),
			userName: v.optional(v.string()),
			userEmail: v.optional(v.string())
		}),
		assignedAdmin: v.optional(
			v.object({
				id: v.string(),
				name: v.optional(v.string()),
				email: v.optional(v.string()),
				image: v.union(v.string(), v.null())
			})
		),
		user: v.optional(
			v.object({
				id: v.string(),
				name: v.optional(v.string()),
				email: v.optional(v.string()),
				image: v.union(v.string(), v.null())
			})
		)
	}),
	handler: async (ctx, args) => {
		// NEW APPROACH: Get agent thread FIRST (primary source), then LEFT JOIN supportThreads

		// 1. Get agent thread (primary source of truth)
		const agentThread = await ctx.runQuery(components.agent.threads.getThread, {
			threadId: args.threadId
		});

		if (!agentThread) {
			throw new Error(`Agent thread not found for threadId: ${args.threadId}`);
		}

		// 2. Try to get supportThread metadata
		const supportThread = await ctx.db
			.query('supportThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		// 3. Use default values if no supportThreads record exists
		const supportMetadata = supportThread ?? {
			_id: agentThread._id, // Synthetic ID
			_creationTime: agentThread._creationTime,
			threadId: agentThread._id,
			userId: agentThread.userId,
			status: 'open' as const,
			assignedTo: undefined,
			priority: undefined,
			pageUrl: undefined,
			notificationEmail: undefined,
			notificationSentAt: undefined,
			unreadByAdmin: true,
			createdAt: agentThread._creationTime,
			updatedAt: agentThread._creationTime
		};

		// 4. Get assigned admin details
		let assignedAdmin;
		if (supportMetadata.assignedTo) {
			const admin = await ctx.runQuery(components.betterAuth.adapter.findOne, {
				model: 'user',
				where: [{ field: '_id', operator: 'eq', value: supportMetadata.assignedTo }]
			});
			if (admin) {
				assignedAdmin = {
					id: admin._id,
					name: admin.name,
					email: admin.email,
					image: admin.image ?? null
				};
			}
		}

		// 5. Get user details (handle anonymous users)
		let user;
		if (agentThread.userId) {
			if (!isAnonymousUser(agentThread.userId)) {
				// Registered user - lookup in user table
				try {
					const userData = await ctx.runQuery(components.betterAuth.adapter.findOne, {
						model: 'user',
						where: [{ field: '_id', operator: 'eq', value: agentThread.userId }]
					});
					if (userData) {
						user = {
							id: userData._id,
							name: userData.name,
							email: userData.email,
							image: userData.image ?? null
						};
					}
				} catch (error) {
					console.error(`[getThreadForAdmin] Failed to fetch user ${agentThread.userId}:`, error);
					// Leave user as undefined
				}
			}
			// For anonymous users, leave user as undefined
		}

		return {
			...agentThread,
			supportMetadata,
			assignedAdmin,
			user
		};
	}
});

/**
 * Get internal notes for a user
 *
 * Supports both authenticated users and anonymous users (anon_* IDs).
 * Notes are user-level, so they appear across all threads for that user.
 */
export const listInternalUserNotes = adminQuery({
	args: {
		userId: v.string(), // Better Auth user ID or anon_* for anonymous
		paginationOpts: v.optional(paginationOptsValidator)
	},
	returns: v.object({
		page: v.array(
			v.object({
				_id: v.string(),
				_creationTime: v.number(),
				userId: v.string(),
				adminUserId: v.string(),
				content: v.string(),
				createdAt: v.number(),
				adminName: v.optional(v.string()),
				adminEmail: v.optional(v.string())
			})
		),
		isDone: v.boolean(),
		continueCursor: v.string()
	}),
	handler: async (ctx, args) => {
		const notes = await ctx.db
			.query('internalUserNotes')
			.withIndex('by_user', (q) => q.eq('userId', args.userId))
			.order('desc')
			.paginate(args.paginationOpts ?? { numItems: SUPPORT_THREADS_PAGE_SIZE, cursor: null });

		// Batch fetch admin info (optimization: single query instead of N queries)
		const adminIds = [...new Set(notes.page.map((note) => note.adminUserId))];

		type AdminInfo = { _id: string; name?: string; email?: string };
		const adminMap = new Map<string, AdminInfo>();

		if (adminIds.length > 0) {
			// Fetch all admin users with a single query
			const adminsResult = await ctx.runQuery(components.betterAuth.adapter.findMany, {
				model: 'user',
				paginationOpts: { cursor: null, numItems: ADMIN_USERS_BATCH_SIZE },
				where: [{ field: 'role', operator: 'eq', value: 'admin' }]
			});

			// Build lookup map for admins we need using Zod validation
			for (const admin of adminsResult.page) {
				const parsed = betterAuthUserSchema.safeParse(admin);
				if (parsed.success && adminIds.includes(parsed.data._id)) {
					adminMap.set(parsed.data._id, parsed.data);
				}
			}
		}

		// Enrich notes with admin info from the map
		const notesWithAdminInfo = notes.page.map((note) => {
			const admin = adminMap.get(note.adminUserId);
			return {
				...note,
				adminName: admin?.name,
				adminEmail: admin?.email
			};
		});

		return {
			page: notesWithAdminInfo,
			isDone: notes.isDone,
			continueCursor: notes.continueCursor
		};
	}
});

/**
 * Get unread thread count for admin
 * For notification badges
 */
export const getUnreadThreadCount = adminQuery({
	args: {
		adminUserId: v.optional(v.string())
	},
	returns: v.number(),
	handler: async (ctx, args) => {
		if (args.adminUserId) {
			// Count threads assigned to this admin OR unassigned using compound index
			const [assignedToAdmin, unassigned] = await Promise.all([
				ctx.db
					.query('supportThreads')
					.withIndex('by_unread_and_assigned', (q) =>
						q.eq('unreadByAdmin', true).eq('assignedTo', args.adminUserId)
					)
					.collect(),
				ctx.db
					.query('supportThreads')
					.withIndex('by_unread_and_assigned', (q) =>
						q.eq('unreadByAdmin', true).eq('assignedTo', undefined)
					)
					.collect()
			]);
			return assignedToAdmin.length + unassigned.length;
		} else {
			// Count all unread using simple index
			const unreadThreads = await ctx.db
				.query('supportThreads')
				.withIndex('by_unread', (q) => q.eq('unreadByAdmin', true))
				.collect();
			return unreadThreads.length;
		}
	}
});

/**
 * List all admin users for assignment dropdown
 */
export const listAdmins = adminQuery({
	args: {},
	returns: v.array(
		v.object({
			id: v.string(),
			name: v.optional(v.string()),
			email: v.optional(v.string()),
			image: v.union(v.string(), v.null())
		})
	),
	handler: async (ctx) => {
		// Fetch all users with admin role
		const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
			model: 'user',
			paginationOpts: { cursor: null, numItems: ADMIN_USERS_BATCH_SIZE },
			where: [{ field: 'role', operator: 'eq', value: 'admin' }]
		});

		// Parse and filter valid admin records using Zod validation
		const admins = parseBetterAuthUsers(result.page);

		// Return admin info
		return admins.map((admin) => ({
			id: admin._id,
			name: admin.name,
			email: admin.email,
			image: admin.image ?? null
		}));
	}
});

/**
 * Debug helper to inspect supportThreads table
 * Usage: bunx convex run admin/support/queries:debugSupportThreads
 */
export const debugSupportThreads = adminQuery({
	args: {},
	returns: v.object({
		count: v.number(),
		threads: v.array(
			v.object({
				_id: v.string(),
				threadId: v.string(),
				userId: v.optional(v.string()),
				status: v.union(v.literal('open'), v.literal('done')),
				assignedTo: v.optional(v.string())
			})
		)
	}),
	handler: async (ctx) => {
		const supportThreads = await ctx.db.query('supportThreads').collect();

		console.log(`[debugSupportThreads] Found ${supportThreads.length} total supportThreads`);

		return {
			count: supportThreads.length,
			threads: supportThreads.map((t) => ({
				_id: t._id,
				threadId: t.threadId,
				userId: t.userId,
				status: t.status,
				assignedTo: t.assignedTo
			}))
		};
	}
});
