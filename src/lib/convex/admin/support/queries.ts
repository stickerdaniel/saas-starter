import { v } from 'convex/values';
import * as val from 'valibot';
import { components } from '../../_generated/api';
import { paginationOptsValidator } from 'convex/server';
import { adminQuery } from '../../functions';
import { SUPPORT_THREADS_PAGE_SIZE, ADMIN_USERS_BATCH_SIZE } from './constants';
import { parseBetterAuthUsers, betterAuthUserSchema } from '../types';
import { isAnonymousUser } from '../../utils/anonymousUser';
import { vStreamArgs } from '@convex-dev/agent/validators';
import { listMessagesForThread } from '../../support/messageListing';
import { supportThreadFields } from '../../support/supportThreadFields';

/** Return validator for supportThreads documents (schema fields + system fields). */
const vSupportMetadata = v.object({
	_id: v.string(),
	_creationTime: v.number(),
	...supportThreadFields
});

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
				supportMetadata: vSupportMetadata,
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
					// Only show threads that have been handed off to human support
					let filter = q.search('searchText', searchQuery).eq('isHandedOff', true);
					if (statusFilter) filter = filter.eq('status', statusFilter);
					if (isUnassigned) filter = filter.eq('assignedTo', undefined);
					else if (assignedToFilter) filter = filter.eq('assignedTo', assignedToFilter);
					return filter;
				})
				.paginate(paginationOpts);
		} else {
			// NON-SEARCH PATH: Only show threads that have been handed off to human support
			// All paths filter by isHandedOff === true
			if (statusFilter && (isUnassigned || assignedToFilter)) {
				// Combined: status + assignment (use compound index + filter for isHandedOff)
				supportThreads = await ctx.db
					.query('supportThreads')
					.withIndex('by_status_and_assigned', (q) =>
						q
							.eq('status', statusFilter)
							.eq('assignedTo', isUnassigned ? undefined : assignedToFilter)
					)
					.filter((q) => q.eq(q.field('isHandedOff'), true))
					.order('desc')
					.paginate(paginationOpts);
			} else if (statusFilter) {
				// Status only - use new compound index
				supportThreads = await ctx.db
					.query('supportThreads')
					.withIndex('by_handed_off_and_status', (q) =>
						q.eq('isHandedOff', true).eq('status', statusFilter)
					)
					.order('desc')
					.paginate(paginationOpts);
			} else if (isUnassigned) {
				// Unassigned only (no status filter)
				supportThreads = await ctx.db
					.query('supportThreads')
					.withIndex('by_assigned', (q) => q.eq('assignedTo', undefined))
					.filter((q) => q.eq(q.field('isHandedOff'), true))
					.order('desc')
					.paginate(paginationOpts);
			} else if (assignedToFilter) {
				// Specific admin only (no status filter)
				supportThreads = await ctx.db
					.query('supportThreads')
					.withIndex('by_assigned', (q) => q.eq('assignedTo', assignedToFilter))
					.filter((q) => q.eq(q.field('isHandedOff'), true))
					.order('desc')
					.paginate(paginationOpts);
			} else {
				// No filters - use new index for isHandedOff only
				supportThreads = await ctx.db
					.query('supportThreads')
					.withIndex('by_handed_off_and_status', (q) => q.eq('isHandedOff', true))
					.order('desc')
					.paginate(paginationOpts);
			}
		}

		// =========================================================================
		// ENRICHMENT: Read generic agent-thread metadata after support registry selection
		// =========================================================================
		const threadsWithDetails = await Promise.all(
			supportThreads.page.map(async (supportThread) => {
				try {
					const agentThread = await ctx.runQuery(components.agent.threads.getThread, {
						threadId: supportThread.threadId
					});

					if (!agentThread) {
						// Thread was deleted but supportThread still exists - skip it
						return null;
					}

					return {
						_id: supportThread.threadId,
						_creationTime: supportThread.createdAt,
						userId: supportThread.userId,
						title: supportThread.title,
						summary: supportThread.summary,
						status: agentThread.status,
						supportMetadata: supportThread,
						lastMessage: supportThread.lastMessage,
						lastMessageAt: supportThread.lastMessageAt,
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
			// Fetch each user individually by ID to avoid fetching arbitrary first-N users
			const userResults = await Promise.all(
				userIds.map((userId) =>
					ctx.runQuery(components.betterAuth.adapter.findOne, {
						model: 'user',
						where: [{ field: '_id', operator: 'eq', value: userId }]
					})
				)
			);

			// Build lookup map for user images
			for (const user of userResults) {
				if (!user) continue;
				const parsed = val.safeParse(betterAuthUserSchema, user);
				if (parsed.success && parsed.output.image) {
					userImageMap.set(parsed.output._id, parsed.output.image);
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
		supportMetadata: vSupportMetadata,
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
		const supportThread = await ctx.db
			.query('supportThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		if (!supportThread) {
			throw new Error(`Support thread not found for threadId: ${args.threadId}`);
		}

		const agentThread = await ctx.runQuery(components.agent.threads.getThread, {
			threadId: args.threadId
		});

		if (!agentThread) {
			throw new Error(`Agent thread not found for threadId: ${args.threadId}`);
		}

		// 4. Get assigned admin details
		let assignedAdmin;
		if (supportThread.assignedTo) {
			const admin = await ctx.runQuery(components.betterAuth.adapter.findOne, {
				model: 'user',
				where: [{ field: '_id', operator: 'eq', value: supportThread.assignedTo }]
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
		if (supportThread.userId) {
			if (!isAnonymousUser(supportThread.userId)) {
				// Registered user - lookup in user table
				try {
					const userData = await ctx.runQuery(components.betterAuth.adapter.findOne, {
						model: 'user',
						where: [{ field: '_id', operator: 'eq', value: supportThread.userId }]
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
					console.error(`[getThreadForAdmin] Failed to fetch user ${supportThread.userId}:`, error);
					// Leave user as undefined
				}
			}
			// For anonymous users, leave user as undefined
		}

		return {
			_id: supportThread.threadId,
			_creationTime: supportThread.createdAt,
			userId: supportThread.userId,
			title: supportThread.title,
			summary: supportThread.summary,
			status: agentThread.status,
			supportMetadata: supportThread,
			assignedAdmin,
			user
		};
	}
});

export const listMessagesForAdmin = adminQuery({
	args: {
		threadId: v.string(),
		paginationOpts: paginationOptsValidator,
		streamArgs: vStreamArgs
	},
	handler: async (ctx, args): Promise<unknown> => {
		const supportThread = await ctx.db
			.query('supportThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		if (!supportThread) {
			throw new Error(`Support thread not found for threadId: ${args.threadId}`);
		}

		return await listMessagesForThread(ctx, {
			threadId: args.threadId,
			paginationOpts: args.paginationOpts,
			streamArgs: args.streamArgs
		});
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

			// Build lookup map for admins we need using Valibot validation
			for (const admin of adminsResult.page) {
				const parsed = val.safeParse(betterAuthUserSchema, admin);
				if (parsed.success && adminIds.includes(parsed.output._id)) {
					adminMap.set(parsed.output._id, parsed.output);
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
 * Get count of threads awaiting admin response (capped at 100)
 *
 * Returns min(actualCount, 100) for sidebar badge display.
 * UI shows "99+" when the returned value is 100.
 */
export const getAwaitingResponseCount = adminQuery({
	args: {},
	returns: v.number(),
	handler: async (ctx) => {
		// Capped at 100 to avoid unbounded scan; UI shows "99+" for >= 100
		const awaitingThreads = await ctx.db
			.query('supportThreads')
			.withIndex('by_needs_response', (q) =>
				q.eq('isHandedOff', true).eq('status', 'open').eq('awaitingAdminResponse', true)
			)
			.take(100);
		return awaitingThreads.length;
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

		// Parse and filter valid admin records using Valibot validation
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
