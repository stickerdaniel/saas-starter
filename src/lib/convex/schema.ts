import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
	// Note: Better Auth component manages its own tables (users, sessions, accounts, verifications)

	// Demo messages table (used in dashboard for billing demo)
	// Note: Better Auth uses 'user' table (singular), managed by the component
	messages: defineTable({
		userId: v.string(), // Better Auth user ID (string, not document ID)
		body: v.string()
	}).index('by_user', ['userId']),

	// Email event tracking - stores webhook events from Resend
	emailEvents: defineTable({
		emailId: v.string(), // Resend email ID
		eventType: v.string(), // 'email.delivered', 'email.bounced', etc.
		timestamp: v.number(), // When the event occurred
		data: v.any() // Full event payload from Resend
	})
		.index('by_email_id', ['emailId'])
		.index('by_event_type', ['eventType'])
		.index('by_timestamp', ['timestamp']),

	// Admin audit logs - tracks admin actions for accountability
	adminAuditLogs: defineTable({
		adminUserId: v.string(), // Admin who performed the action
		action: v.union(
			v.literal('impersonate'),
			v.literal('stop_impersonation'),
			v.literal('ban_user'),
			v.literal('unban_user'),
			v.literal('revoke_sessions'),
			v.literal('set_role')
		),
		targetUserId: v.string(), // User affected by the action
		// Typed metadata per action type (not v.any() for type safety)
		metadata: v.optional(
			v.union(
				v.object({ reason: v.string() }), // ban_user, unban_user
				v.object({ newRole: v.string(), previousRole: v.string() }), // set_role
				v.object({}) // impersonate, stop_impersonation, revoke_sessions
			)
		),
		timestamp: v.number()
	})
		.index('by_admin', ['adminUserId'])
		.index('by_target', ['targetUserId'])
		.index('by_timestamp', ['timestamp']),

	// Internal notes for users - visible only to admins, not to users
	// Supports both authenticated users (Better Auth IDs) and anonymous users (anon_*)
	internalUserNotes: defineTable({
		userId: v.string(), // Reference to user (Better Auth ID or anon_*)
		adminUserId: v.string(), // Admin who created the note
		content: v.string(), // Note content
		createdAt: v.number() // Timestamp when note was created
	})
		.index('by_user', ['userId'])
		.index('by_admin', ['adminUserId'])
		.index('by_created', ['createdAt']),

	// Support thread metadata - extends agent threads with admin features
	// (agent threads don't support custom metadata, so we store admin-specific data separately)
	supportThreads: defineTable({
		threadId: v.string(), // Reference to agent:threads
		userId: v.optional(v.string()), // Denormalized for quick lookups
		status: v.union(v.literal('open'), v.literal('done')),
		assignedTo: v.optional(v.string()), // Admin user ID
		priority: v.optional(v.union(v.literal('low'), v.literal('medium'), v.literal('high'))),
		dueDate: v.optional(v.number()),
		pageUrl: v.optional(v.string()), // URL where user started chat
		unreadByAdmin: v.boolean(),
		createdAt: v.number(),
		updatedAt: v.number(),

		// Denormalized search fields (for server-side full-text search)
		searchText: v.optional(v.string()), // Combined: title | summary | lastMessage | userName | userEmail
		title: v.optional(v.string()), // From agent:threads
		summary: v.optional(v.string()), // From agent:threads
		lastMessage: v.optional(v.string()), // From agent:messages (truncated to 500 chars)
		userName: v.optional(v.string()), // From user table
		userEmail: v.optional(v.string()) // From user table
	})
		.index('by_thread', ['threadId'])
		.index('by_user', ['userId'])
		.index('by_status', ['status'])
		.index('by_assigned', ['assignedTo'])
		.index('by_created', ['createdAt'])
		.index('by_unread', ['unreadByAdmin'])
		.index('by_unread_and_assigned', ['unreadByAdmin', 'assignedTo'])
		.searchIndex('search_all', {
			searchField: 'searchText',
			filterFields: ['status', 'assignedTo', 'unreadByAdmin']
		})

	// Note: The agent component automatically creates the following tables:
	// - agent:threads - Conversation threads for customer support
	// - agent:messages - Messages within threads (separate from demo messages table)
	// - agent:streamingDeltas - Real-time streaming chunks
	// - agent:embeddings - Vector embeddings for semantic search
});
