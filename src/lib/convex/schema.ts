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

	// Support tickets - submitted via AI agent
	supportTickets: defineTable({
		threadId: v.string(), // Reference to agent thread
		ticketType: v.union(
			v.literal('bug_report'),
			v.literal('feature_request'),
			v.literal('general_inquiry')
		),
		title: v.string(),
		description: v.string(),
		userEmail: v.string(),
		userName: v.optional(v.string()),
		userId: v.optional(v.string()), // Better Auth user ID (string, not document ID)
		fileIds: v.optional(v.array(v.object({ filename: v.string(), url: v.string() }))), // Attached files with names
		status: v.union(
			v.literal('submitted'),
			v.literal('in_progress'),
			v.literal('resolved'),
			v.literal('closed')
		),
		emailId: v.optional(v.string()), // Resend email ID for tracking (legacy, admin email)
		userEmailId: v.optional(v.string()), // Resend email ID for user confirmation
		adminEmailId: v.optional(v.string()), // Resend email ID for admin notification
		emailDeliveryStatus: v.optional(
			v.union(
				v.literal('pending'), // Waiting for delivery confirmation
				v.literal('delivered'), // Both emails delivered successfully
				v.literal('failed') // At least one email failed
			)
		),
		emailError: v.optional(v.string()), // Error message if delivery failed
		// Fields for deferred tool-result (saved when webhook arrives)
		toolCallId: v.optional(v.string()), // Tool call ID for saving result later
		promptMessageId: v.optional(v.string()), // Prompt message ID for agent continuation
		submittedAt: v.number()
	})
		.index('by_thread', ['threadId'])
		.index('by_user', ['userId'])
		.index('by_status', ['status'])
		.index('by_submitted', ['submittedAt'])
		.index('by_user_email_id', ['userEmailId'])
		.index('by_admin_email_id', ['adminEmailId']),

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

	// Admin notes for users - internal notes not visible to users
	// Supports both authenticated users (Better Auth IDs) and anonymous users (anon_*)
	adminNotes: defineTable({
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
		updatedAt: v.number()
	})
		.index('by_thread', ['threadId'])
		.index('by_user', ['userId'])
		.index('by_status', ['status'])
		.index('by_assigned', ['assignedTo'])
		.index('by_created', ['createdAt'])

	// Note: The agent component automatically creates the following tables:
	// - agent:threads - Conversation threads for customer support
	// - agent:messages - Messages within threads (separate from demo messages table)
	// - agent:streamingDeltas - Real-time streaming chunks
	// - agent:embeddings - Vector embeddings for semantic search
});
