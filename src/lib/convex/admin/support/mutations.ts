import { mutation } from '../../_generated/server';
import { v } from 'convex/values';
import { components } from '../../_generated/api';
import { supportAgent } from '../../support/agent';
import { adminMutation } from '../../functions';

/**
 * Assign thread to admin
 *
 * Updates the supportThreads table (agent threads don't support metadata).
 */
export const assignThread = adminMutation({
	args: {
		threadId: v.string(),
		adminUserId: v.optional(v.string()) // undefined to unassign
	},
	handler: async (ctx, args) => {
		// Find supportThread by threadId
		const supportThread = await ctx.db
			.query('supportThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		if (!supportThread) {
			throw new Error('Support thread not found');
		}

		// Update assignedTo
		await ctx.db.patch(supportThread._id, {
			assignedTo: args.adminUserId,
			updatedAt: Date.now()
		});
	}
});

/**
 * Update thread status
 */
export const updateThreadStatus = adminMutation({
	args: {
		threadId: v.string(),
		status: v.union(v.literal('open'), v.literal('done'))
	},
	handler: async (ctx, args) => {
		const supportThread = await ctx.db
			.query('supportThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		if (!supportThread) {
			throw new Error('Support thread not found');
		}

		await ctx.db.patch(supportThread._id, {
			status: args.status,
			updatedAt: Date.now()
		});
	}
});

/**
 * Update thread priority
 */
export const updateThreadPriority = adminMutation({
	args: {
		threadId: v.string(),
		priority: v.optional(v.union(v.literal('low'), v.literal('medium'), v.literal('high')))
	},
	handler: async (ctx, args) => {
		const supportThread = await ctx.db
			.query('supportThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		if (!supportThread) {
			throw new Error('Support thread not found');
		}

		await ctx.db.patch(supportThread._id, {
			priority: args.priority,
			updatedAt: Date.now()
		});
	}
});

/**
 * Update thread due date
 */
export const updateThreadDueDate = adminMutation({
	args: {
		threadId: v.string(),
		dueDate: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const supportThread = await ctx.db
			.query('supportThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		if (!supportThread) {
			throw new Error('Support thread not found');
		}

		await ctx.db.patch(supportThread._id, {
			dueDate: args.dueDate,
			updatedAt: Date.now()
		});
	}
});

/**
 * Send admin reply to thread
 *
 * This adds a human admin message (distinct from AI) using message metadata.
 * Does NOT trigger AI response.
 */
export const sendAdminReply = adminMutation({
	args: {
		threadId: v.string(),
		prompt: v.string(),
		fileIds: v.optional(v.array(v.string()))
	},
	handler: async (ctx, args) => {
		// Validate content
		if (!args.prompt.trim()) {
			throw new Error('Message content cannot be empty');
		}

		// Use agent saveMessage with providerMetadata for admin info
		// NOTE: Messages don't support arbitrary custom metadata fields, so we use providerMetadata
		await supportAgent.saveMessage(ctx, {
			threadId: args.threadId,
			prompt: args.prompt.trim(),
			metadata: {
				providerMetadata: {
					admin: {
						isAdminMessage: true,
						adminUserId: ctx.user._id,
						adminName: ctx.user.name || ctx.user.email || 'Admin',
						adminEmail: ctx.user.email
					}
				}
			},
			skipEmbeddings: true // Don't embed admin messages
		});

		// Mark as read by admin
		const supportThread = await ctx.db
			.query('supportThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		if (supportThread) {
			await ctx.db.patch(supportThread._id, {
				unreadByAdmin: false,
				updatedAt: Date.now()
			});
		}
	}
});

/**
 * Mark thread as read by admin
 */
export const markThreadAsRead = adminMutation({
	args: { threadId: v.string() },
	handler: async (ctx, args) => {
		const supportThread = await ctx.db
			.query('supportThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		if (supportThread) {
			await ctx.db.patch(supportThread._id, {
				unreadByAdmin: false,
				updatedAt: Date.now()
			});
		}
	}
});

/**
 * Add internal note for a user (not visible to users)
 *
 * Supports both authenticated users and anonymous users (anon_* IDs).
 */
export const addInternalUserNote = adminMutation({
	args: {
		userId: v.string(), // Better Auth user ID or anon_*
		content: v.string()
	},
	handler: async (ctx, args) => {
		// Validate content
		if (!args.content.trim()) {
			throw new Error('Note content cannot be empty');
		}

		await ctx.db.insert('internalUserNotes', {
			userId: args.userId,
			adminUserId: ctx.user._id,
			content: args.content.trim(),
			createdAt: Date.now()
		});
	}
});

/**
 * Delete internal user note
 */
export const deleteInternalUserNote = adminMutation({
	args: {
		noteId: v.id('internalUserNotes')
	},
	handler: async (ctx, args) => {
		const note = await ctx.db.get(args.noteId);

		if (!note) {
			throw new Error('Note not found');
		}

		await ctx.db.delete(args.noteId);
	}
});

/**
 * Discover and backfill supportThreads from existing agent threads
 *
 * This mutation scans all users and their threads, creating supportThreads
 * records for any threads that don't have one yet.
 *
 * Run this once to populate the supportThreads table with existing threads.
 *
 * Usage: bunx convex run admin/support/mutations:discoverThreads
 *
 * NOTE: No auth required - this is a CLI-only migration tool.
 * Anyone with CLI access to Convex already has full deployment access.
 */
export const discoverThreads = mutation({
	args: {},
	handler: async (ctx) => {
		// No auth check - this is a CLI migration tool

		let created = 0;
		let skipped = 0;
		let errors = 0;

		// Get all users (paginated)
		const usersResult = await ctx.runQuery(components.betterAuth.adapter.findMany, {
			model: 'user',
			paginationOpts: { cursor: null, numItems: 100 }
		});

		const users = usersResult.page as Array<{ _id: string }>;

		// For each user, get their threads
		for (const user of users) {
			try {
				const threadsResult = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
					userId: user._id,
					paginationOpts: { cursor: null, numItems: 100 },
					order: 'desc'
				});

				// For each thread, check if supportThread exists
				for (const thread of threadsResult.page) {
					const existing = await ctx.db
						.query('supportThreads')
						.withIndex('by_thread', (q) => q.eq('threadId', thread._id))
						.first();

					if (existing) {
						skipped++;
						continue;
					}

					// Create supportThread record with defaults
					await ctx.db.insert('supportThreads', {
						threadId: thread._id,
						userId: thread.userId,
						status: 'open',
						assignedTo: undefined,
						priority: undefined,
						dueDate: undefined,
						pageUrl: undefined,
						unreadByAdmin: true,
						createdAt: thread._creationTime,
						updatedAt: thread._creationTime
					});

					created++;
				}
			} catch (error) {
				console.error(`Error processing user ${user._id}:`, error);
				errors++;
			}
		}

		return {
			created,
			skipped,
			errors,
			message: `Created ${created} supportThreads records, skipped ${skipped} existing, ${errors} errors`
		};
	}
});
