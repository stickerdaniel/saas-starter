import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { vEmailEvent } from '@convex-dev/resend';
import { supportThreadFields } from './support/supportThreadFields';

export default defineSchema({
	// Note: Better Auth component manages its own tables (users, sessions, accounts, verifications)

	// Demo messages table (used in dashboard for billing demo)
	// Note: Better Auth uses 'user' table (singular), managed by the component
	messages: defineTable({
		userId: v.string(), // Better Auth user ID (string, not document ID)
		body: v.string()
	}).index('by_user', ['userId']),

	// Email event tracking - stores webhook events from Resend
	// Intentionally write-only for now: inspect events via the Convex dashboard.
	// by_email_id is the documented read path (AGENTS.md Email Event Tracking);
	// add a query on it when needed.
	emailEvents: defineTable({
		emailId: v.string(), // Resend email ID
		eventType: v.string(), // 'email.delivered', 'email.bounced', etc.
		timestamp: v.number(), // When the event occurred
		data: vEmailEvent // Full event payload from Resend
	}).index('by_email_id', ['emailId']),

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
				v.object({ durationMs: v.number() }), // stop_impersonation
				v.object({}) // impersonate, revoke_sessions
			)
		),
		timestamp: v.number()
	})
		.index('by_admin', ['adminUserId'])
		.index('by_target', ['targetUserId'])
		.index('by_action', ['action'])
		.index('by_admin_action', ['adminUserId', 'action'])
		.index('by_target_action', ['targetUserId', 'action'])
		.index('by_timestamp', ['timestamp']),

	// Internal notes for users - visible only to admins, not to users
	// Supports both authenticated users (Better Auth IDs) and anonymous users
	// See: src/lib/convex/utils/anonymousUser.ts for ANONYMOUS_USER_PREFIX constant
	internalUserNotes: defineTable({
		userId: v.string(), // Reference to user (Better Auth ID or anonymous ID)
		adminUserId: v.string(), // Admin who created the note
		content: v.string(), // Note content
		createdAt: v.number() // Timestamp when note was created
	}).index('by_user', ['userId']),

	// Support feature registry.
	// Source of truth for support thread membership, access, and denormalized list/search data.
	// agent:threads remains generic conversation storage/runtime shared across features.
	supportThreads: defineTable(supportThreadFields)
		.index('by_thread', ['threadId'])
		.index('by_user', ['userId'])
		.index('by_user_warm', ['userId', 'isWarm'])
		.index('by_user_and_updated', ['userId', 'updatedAt'])
		.index('by_assigned', ['assignedTo'])
		.index('by_status_and_assigned', ['status', 'assignedTo'])
		.index('by_handed_off_and_status', ['isHandedOff', 'status'])
		.index('by_needs_response', ['isHandedOff', 'status', 'awaitingAdminResponse'])
		.searchIndex('search_all', {
			searchField: 'searchText',
			filterFields: ['status', 'assignedTo', 'isHandedOff', 'awaitingAdminResponse']
		}),

	// Stored overrides for the support agent's system prompt. support/promptStore
	// serves the active row at runtime (support/messages.ts) in place of the seed
	// prompt in agent.ts (SUPPORT_AGENT_INSTRUCTIONS), which stays the fallback
	// when no row is active. Lets you hot-swap the prompt from the database, or
	// from a prompt-optimization run, without a deploy. At most one active row
	// per locale (the by_active index keeps getActive off a full-table scan).
	supportAgentPrompts: defineTable({
		systemPrompt: v.string(), // Full prompt served in place of the seed
		locale: v.optional(v.string()), // Scopes the override to one locale; absent = default for all
		note: v.optional(v.string()), // Freeform: why this override exists / where it came from
		active: v.boolean(), // Whether getActive may serve this row
		createdAt: v.number()
	}).index('by_active', ['active']),

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
		retryCount: v.optional(v.number()), // Number of retry attempts (stops after 5)
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

	adminProfiles: defineTable({
		userId: v.string(),
		founderWelcomeName: v.optional(v.string()),
		founderWelcomeTitle: v.optional(v.string()),
		founderWelcomeReplyTo: v.optional(v.string())
	}).index('by_user', ['userId']),

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
		.index('by_url', ['url'])
		// Used by the hourly file vacuum to delete metadata of purged files
		.index('by_storageId', ['storageId']),

	// Dashboard counters - singleton for materialized user metrics
	// Updated atomically via auth triggers (onCreate, onUpdate) to avoid
	// fetching all users on every dashboard load.
	dashboardCounters: defineTable({
		totalUsers: v.number(),
		adminCount: v.number(),
		bannedCount: v.number()
	}),

	// Founder welcome emails - delayed personal welcome from a team member
	// Sent ~16-19 min after signup to feel organic. Config stored in adminSettings.
	founderWelcomeEmails: defineTable({
		userId: v.string(),
		signupEmail: v.string(),
		delayMs: v.number(),
		status: v.union(
			v.literal('pending_verification'),
			v.literal('scheduled'),
			v.literal('sent'),
			v.literal('skipped')
		),
		scheduledFnId: v.optional(v.id('_scheduled_functions')),
		sentAt: v.optional(v.number()),
		skippedReason: v.optional(v.string()),
		createdAt: v.number()
	}).index('by_user', ['userId']),

	// AI chat feature registry.
	// Source of truth for AI chat membership and sidebar state.
	// Denormalized fields avoid ctx.runQuery into generic agent tables on the hot path.
	aiChatThreads: defineTable({
		threadId: v.string(), // Reference to agent:threads
		userId: v.string(), // Better Auth user ID
		createdAt: v.number(),
		isWarm: v.optional(v.boolean()), // true = pre-warmed empty thread, awaiting first message
		title: v.optional(v.string()),
		lastMessage: v.optional(v.string()),
		lastMessageAt: v.optional(v.number())
	})
		.index('by_user', ['userId'])
		.index('by_thread', ['threadId'])
		.index('by_user_warm', ['userId', 'isWarm']),

	// Per-LLM-operation usage + cost. One row per call (single-shot) or per
	// assistant turn (agent). costUsd is authoritative and stamped at write time
	// (never recomputed at query time). Write-only like emailEvents until a
	// billing/admin query is added on by_user_at.
	aiUsage: defineTable({
		userId: v.optional(v.string()), // Better Auth _id, anon_* id, or absent
		feature: v.union(v.literal('ai_chat'), v.literal('ai_chat_title'), v.literal('support_chat')),
		threadId: v.optional(v.string()),
		status: v.union(v.literal('ok'), v.literal('partial'), v.literal('error')),
		models: v.array(
			v.object({
				model: v.string(),
				provider: v.optional(v.string()),
				inputTokens: v.number(),
				outputTokens: v.number(),
				totalTokens: v.number(),
				reasoningTokens: v.optional(v.number()),
				cachedInputTokens: v.optional(v.number()),
				costUsd: v.number(),
				costSource: v.union(v.literal('native'), v.literal('computed'), v.literal('unknown'))
			})
		),
		inputTokens: v.number(),
		outputTokens: v.number(),
		totalTokens: v.number(),
		reasoningTokens: v.optional(v.number()),
		cachedInputTokens: v.optional(v.number()),
		costUsd: v.number(),
		costSource: v.union(
			v.literal('native'),
			v.literal('computed'),
			v.literal('mixed'),
			v.literal('unknown')
		),
		at: v.number()
	})
		.index('by_user_at', ['userId', 'at'])
		.index('by_feature_at', ['feature', 'at'])

	// Note: The agent component automatically creates the following tables:
	// - agent:threads - Conversation threads for customer support
	// - agent:messages - Messages within threads (separate from demo messages table)
	// - agent:streamingDeltas - Real-time streaming chunks
	// - agent:embeddings - Vector embeddings for semantic search
});
