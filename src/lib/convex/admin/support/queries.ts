import { query } from '../../_generated/server';
import { v } from 'convex/values';
import { components } from '../../_generated/api';
import { paginationOptsValidator } from 'convex/server';

/**
 * List threads with admin filters
 *
 * ARCHITECTURE: Queries supportThreads table with admin metadata.
 * Run `bunx convex run admin.support.migrations.discoverThreads` to populate
 * supportThreads from existing agent threads.
 *
 * Supports filtering by:
 * - assignedTo (specific admin or null for unassigned)
 * - status (open, done)
 * - search (title, summary, or message content)
 *
 * Returns threads sorted by lastMessageAt (most recent first)
 */
export const listThreadsForAdmin = query({
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
					priority: v.optional(v.union(v.literal('low'), v.literal('medium'), v.literal('high'))),
					dueDate: v.optional(v.number()),
					pageUrl: v.optional(v.string()),
					unreadByAdmin: v.boolean(),
					createdAt: v.number(),
					updatedAt: v.number()
				}),
				lastMessage: v.optional(v.string()),
				lastMessageAt: v.optional(v.number()),
				userName: v.optional(v.string()),
				userEmail: v.optional(v.string())
			})
		),
		isDone: v.boolean(),
		continueCursor: v.string()
	}),
	handler: async (ctx, args) => {
		// NEW APPROACH: Auto-discover threads if supportThreads is empty
		// This handles the case where supportThreads table hasn't been populated yet

		console.log(
			`[listThreadsForAdmin] Query params - filter: ${JSON.stringify(args.filter)}, status: ${args.status}, search: ${args.search}`
		);

		// 1. Query supportThreads table with filters
		let supportThreads;

		if (args.status !== undefined) {
			// Use status index
			const status = args.status; // Store in const for TypeScript
			supportThreads = await ctx.db
				.query('supportThreads')
				.withIndex('by_status', (q) => q.eq('status', status))
				.order('desc')
				.paginate(args.paginationOpts ?? { numItems: 50, cursor: null });
		} else if (args.filter === 'unassigned') {
			// Use assignment index for unassigned
			supportThreads = await ctx.db
				.query('supportThreads')
				.withIndex('by_assigned', (q) => q.eq('assignedTo', undefined))
				.order('desc')
				.paginate(args.paginationOpts ?? { numItems: 50, cursor: null });
		} else if (typeof args.filter === 'object' && 'assignedTo' in args.filter) {
			// Use assignment index for specific admin
			const adminId = (args.filter as { assignedTo: string }).assignedTo;
			supportThreads = await ctx.db
				.query('supportThreads')
				.withIndex('by_assigned', (q) => q.eq('assignedTo', adminId))
				.order('desc')
				.paginate(args.paginationOpts ?? { numItems: 50, cursor: null });
		} else {
			// No index - get all
			supportThreads = await ctx.db
				.query('supportThreads')
				.order('desc')
				.paginate(args.paginationOpts ?? { numItems: 50, cursor: null });
		}

		console.log(`[listThreadsForAdmin] Found ${supportThreads.page.length} supportThreads records`);

		// 2. For each supportThread, get agent thread + last message + user info
		console.log(
			`[listThreadsForAdmin] Starting enrichment for ${supportThreads.page.length} threads`
		);
		const threadsWithDetails = await Promise.all(
			supportThreads.page.map(async (supportThread) => {
				try {
					// Get agent thread
					console.log(`[listThreadsForAdmin] Looking up agent thread: ${supportThread.threadId}`);
					const agentThread = await ctx.runQuery(components.agent.threads.getThread, {
						threadId: supportThread.threadId
					});

					if (!agentThread) {
						// Thread was deleted but supportThread still exists - skip it
						console.log(
							`[listThreadsForAdmin] ⚠️ Agent thread NOT FOUND for threadId: ${supportThread.threadId}`
						);
						return null;
					}

					console.log(
						`[listThreadsForAdmin] ✓ Agent thread found: ${agentThread._id}, title: ${agentThread.title || 'untitled'}`
					);

					// Get last message
					console.log(
						`[listThreadsForAdmin] Fetching messages for thread ${supportThread.threadId}`
					);
					const messages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
						threadId: supportThread.threadId,
						order: 'desc',
						statuses: ['success'],
						excludeToolMessages: true,
						paginationOpts: { numItems: 1, cursor: null }
					});
					console.log(`[listThreadsForAdmin] Found ${messages.page.length} messages`);

					const lastMessage = messages.page[0];

					// Get user info if userId exists and is valid Convex ID
					let userName, userEmail;
					if (agentThread.userId) {
						// Check if userId is a valid Convex ID (anonymous users have format: anon_*)
						const isAnonymous = agentThread.userId.startsWith('anon_');

						if (isAnonymous) {
							// Anonymous user - don't query user table
							console.log(`[listThreadsForAdmin] Anonymous user: ${agentThread.userId}`);
							userName = undefined;
							userEmail = undefined;
						} else {
							// Registered user - lookup in user table
							console.log(
								`[listThreadsForAdmin] Fetching user info for userId ${agentThread.userId}`
							);
							try {
								const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
									model: 'user',
									where: [{ field: '_id', operator: 'eq', value: agentThread.userId }]
								});
								userName = user?.name;
								userEmail = user?.email;
								console.log(
									`[listThreadsForAdmin] User info: ${userName || 'no name'} (${userEmail || 'no email'})`
								);
							} catch (error) {
								console.error(
									`[listThreadsForAdmin] Failed to fetch user ${agentThread.userId}:`,
									error
								);
								userName = undefined;
								userEmail = undefined;
							}
						}
					}

					console.log(
						`[listThreadsForAdmin] ✓ Successfully enriched thread ${supportThread.threadId}`
					);

					return {
						_id: agentThread._id,
						_creationTime: agentThread._creationTime,
						userId: agentThread.userId,
						title: agentThread.title,
						summary: agentThread.summary,
						status: agentThread.status,
						supportMetadata: supportThread,
						lastMessage: lastMessage?.text,
						lastMessageAt: lastMessage?._creationTime ?? agentThread._creationTime,
						userName,
						userEmail
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

		console.log(
			`[listThreadsForAdmin] Valid threads: ${validThreads.length}/${threadsWithDetails.length} (filtered out ${threadsWithDetails.length - validThreads.length})`
		);

		// 3. Apply search filter (client-side for now)
		let filteredThreads = validThreads;
		if (args.search) {
			const searchLower = args.search.toLowerCase();
			filteredThreads = validThreads.filter(
				(t) =>
					t.title?.toLowerCase().includes(searchLower) ||
					t.summary?.toLowerCase().includes(searchLower) ||
					t.lastMessage?.toLowerCase().includes(searchLower) ||
					t.userName?.toLowerCase().includes(searchLower) ||
					t.userEmail?.toLowerCase().includes(searchLower)
			);
		}

		console.log(`[listThreadsForAdmin] Returning ${filteredThreads.length} threads to client`);

		return {
			page: filteredThreads,
			isDone: supportThreads.isDone,
			continueCursor: supportThreads.continueCursor
		};
	}
});

/**
 * Get thread details for admin view
 * Includes assignment, status, priority, and user info
 */
export const getThreadForAdmin = query({
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
			priority: v.optional(v.union(v.literal('low'), v.literal('medium'), v.literal('high'))),
			dueDate: v.optional(v.number()),
			pageUrl: v.optional(v.string()),
			unreadByAdmin: v.boolean(),
			createdAt: v.number(),
			updatedAt: v.number()
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
			dueDate: undefined,
			pageUrl: undefined,
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
			// Check if userId is a valid Convex ID (anonymous users have format: anon_*)
			const isAnonymous = agentThread.userId.startsWith('anon_');

			if (!isAnonymous) {
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
 * Get admin notes for a user
 *
 * Supports both authenticated users and anonymous users (anon_* IDs).
 * Notes are user-level, so they appear across all threads for that user.
 */
export const getUserNotes = query({
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
			.query('adminNotes')
			.withIndex('by_user', (q) => q.eq('userId', args.userId))
			.order('desc')
			.paginate(args.paginationOpts ?? { numItems: 50, cursor: null });

		const notesWithAdminInfo = await Promise.all(
			notes.page.map(async (note) => {
				const admin = await ctx.runQuery(components.betterAuth.adapter.findOne, {
					model: 'user',
					where: [{ field: '_id', operator: 'eq', value: note.adminUserId }]
				});

				return {
					...note,
					adminName: admin?.name,
					adminEmail: admin?.email
				};
			})
		);

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
export const getUnreadThreadCount = query({
	args: {
		adminUserId: v.optional(v.string())
	},
	returns: v.number(),
	handler: async (ctx, args) => {
		// Query supportThreads for unread
		const query = ctx.db.query('supportThreads');

		if (args.adminUserId) {
			// Count only threads assigned to this admin or unassigned
			const allThreads = await query.collect();
			return allThreads.filter(
				(t) => t.unreadByAdmin && (!t.assignedTo || t.assignedTo === args.adminUserId)
			).length;
		} else {
			// Count all unread
			const allThreads = await query.collect();
			return allThreads.filter((t) => t.unreadByAdmin).length;
		}
	}
});

/**
 * List all admin users for assignment dropdown
 */
export const listAdmins = query({
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
			paginationOpts: { cursor: null, numItems: 100 },
			where: [{ field: 'role', operator: 'eq', value: 'admin' }]
		});

		const admins = result.page as Array<{
			_id: string;
			name?: string;
			email?: string;
			image?: string | null;
		}>;

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
export const debugSupportThreads = query({
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
