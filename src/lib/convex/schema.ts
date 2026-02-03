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
	// Supports both authenticated users (Better Auth IDs) and anonymous users
	// See: src/lib/convex/utils/anonymousUser.ts for ANONYMOUS_USER_PREFIX constant
	internalUserNotes: defineTable({
		userId: v.string(), // Reference to user (Better Auth ID or anonymous ID)
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
		isHandedOff: v.optional(v.boolean()), // true = human-only mode, undefined/false = AI responds
		awaitingAdminResponse: v.optional(v.boolean()), // true = user waiting for reply, false = admin has responded
		assignedTo: v.optional(v.string()), // Admin user ID (for tracking, not AI control)
		priority: v.optional(v.union(v.literal('low'), v.literal('medium'), v.literal('high'))),
		dueDate: v.optional(v.number()),
		pageUrl: v.optional(v.string()), // URL where user started chat
		createdAt: v.number(),
		updatedAt: v.number(),

		// Denormalized search fields (for server-side full-text search)
		searchText: v.optional(v.string()), // Combined: title | summary | lastMessage | userName | userEmail
		title: v.optional(v.string()), // From agent:threads
		summary: v.optional(v.string()), // From agent:threads
		lastMessage: v.optional(v.string()), // From agent:messages (truncated to 500 chars)
		userName: v.optional(v.string()), // From user table
		userEmail: v.optional(v.string()), // From user table

		// Email notification settings
		notificationEmail: v.optional(v.string()), // Email to notify on admin response
		notificationSentAt: v.optional(v.number()) // Last notification timestamp (for 30-min cooldown)
	})
		.index('by_thread', ['threadId'])
		.index('by_user', ['userId'])
		.index('by_status', ['status'])
		.index('by_assigned', ['assignedTo'])
		.index('by_status_and_assigned', ['status', 'assignedTo'])
		.index('by_created', ['createdAt'])
		.index('by_handed_off_and_status', ['isHandedOff', 'status'])
		.index('by_needs_response', ['isHandedOff', 'status', 'awaitingAdminResponse'])
		.searchIndex('search_all', {
			searchField: 'searchText',
			filterFields: ['status', 'assignedTo', 'isHandedOff', 'awaitingAdminResponse']
		}),

	// Admin settings - key-value store for app configuration
	adminSettings: defineTable({
		key: v.string(), // Setting key (e.g., 'defaultSupportEmail')
		value: v.string(), // Setting value
		updatedAt: v.number(),
		updatedBy: v.optional(v.string()) // Admin who last updated
	}).index('by_key', ['key']),

	// Pending admin notifications - for debounced delivery
	// Triggered when user clicks "Talk to human", sends message to handed-off ticket,
	// or reopens a closed ticket. Uses 2-minute debounce to accumulate multiple messages.
	// Timer resets if user sends more messages within the delay window.
	pendingAdminNotifications: defineTable({
		threadId: v.string(), // Support thread ID
		isReopen: v.boolean(), // true = reopened ticket, false = new/handoff ticket
		notificationType: v.union(v.literal('newTickets'), v.literal('userReplies')), // Which preference toggle to use
		scheduledFor: v.number(), // Timestamp when notification should send
		messageIds: v.array(v.string()), // Accumulated message IDs to include
		scheduledFnId: v.optional(v.id('_scheduled_functions')), // For cancellation
		createdAt: v.number()
	}).index('by_thread', ['threadId']),

	// Admin notification preferences - per-recipient toggles for notification types
	// Admin users are auto-synced via auth triggers; custom emails can be added manually.
	// When admin is demoted, isAdminUser is set to false but record is kept dormant.
	adminNotificationPreferences: defineTable({
		email: v.string(), // Email address to send notifications to
		userId: v.optional(v.string()), // Better Auth user ID (undefined for custom emails)
		isAdminUser: v.boolean(), // true = currently has admin role, false = demoted or custom email

		// Notification type toggles
		notifyNewSupportTickets: v.boolean(), // New support tickets (handoff from AI)
		notifyUserReplies: v.boolean(), // User replied, admin didn't respond within 2 min
		notifyNewSignups: v.boolean(), // New user registrations

		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_email', ['email'])
		.index('by_user', ['userId']),

	// File metadata - stores image dimensions for proper dialog sizing
	// (agent component strips unknown fields from file parts, so we store dimensions separately)
	fileMetadata: defineTable({
		fileId: v.string(), // Reference to agent:files._id
		storageId: v.string(), // Convex storage ID for lookups
		url: v.optional(v.string()), // The actual URL from agent component (optional for legacy records)
		width: v.optional(v.number()),
		height: v.optional(v.number()),
		createdAt: v.number()
	})
		.index('by_fileId', ['fileId'])
		.index('by_storageId', ['storageId'])
		.index('by_url', ['url'])

	// Note: The agent component automatically creates the following tables:
	// - agent:threads - Conversation threads for customer support
	// - agent:messages - Messages within threads (separate from demo messages table)
	// - agent:streamingDeltas - Real-time streaming chunks
	// - agent:embeddings - Vector embeddings for semantic search
});
