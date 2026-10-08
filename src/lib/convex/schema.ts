import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { vEmailEvent } from '@convex-dev/resend';
import { supportThreadFields } from './support/supportThreadFields';
import { vAnonymousRateLimitBucket } from './support/rateLimitAlertFields';
import { founderIncidentEmailFields } from './emails/founderIncidentTypes';
import { aiUsageFeatureValidator } from './aiUsage/feature';
import { journeyCaptureStarts } from './admin/journey/capture';

export default defineSchema({
	// Note: Better Auth component manages its own tables (users, sessions, accounts, verifications)
	passkeyNudgeDismissals: defineTable({
		userId: v.string(),
		deferredUntil: v.number()
	}).index('by_userId', ['userId']),

	// Demo messages table (used in dashboard for billing demo)
	// Note: Better Auth uses 'user' table (singular), managed by the component
	messages: defineTable({
		userId: v.string(), // Better Auth user ID (string, not document ID)
		body: v.string(),
		// Set once the quota backstop keeps the message (counted or billing
		// unavailable); a denied message is deleted instead. Customer journeys
		// count only settled messages.
		quotaSettledAt: v.optional(v.number())
	})
		// Sorts by creation time. The settled index sorts by the marker instead,
		// so the message list cannot use it.
		// eslint-disable-next-line @convex-dev/no-duplicate-indexes -- different sort order
		.index('by_user', ['userId'])
		// Settled messages only. Clearing the marker drops the row out of a
		// `gte(quotaSettledAt, 0)` range, so erasure never walks unmarked history.
		.index('by_user_and_settled', ['userId', 'quotaSettledAt']),

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
		// eslint-disable-next-line @convex-dev/no-duplicate-indexes -- by_admin_action would sort one admin's log by action before time (see admin/auditLog/queries.ts)
		.index('by_admin', ['adminUserId'])
		// eslint-disable-next-line @convex-dev/no-duplicate-indexes -- by_target_action would sort one target's log by action before time (see admin/auditLog/queries.ts)
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
		.index('by_user_warm', ['userId', 'isWarm'])
		.index('by_user_and_last_message', ['userId', 'lastMessageAt'])
		.index('by_user_and_first_user_message', ['userId', 'firstUserMessageAt'])
		.index('by_user_and_unread_admin_reply', ['userId', 'hasUnreadAdminReply'])
		.index('by_handed_off_updated', ['isHandedOff', 'updatedAt'])
		.index('by_handed_off_assigned_updated', ['isHandedOff', 'assignedTo', 'updatedAt'])
		.index('by_handed_off_status_updated', ['isHandedOff', 'status', 'updatedAt'])
		.index('by_handed_off_status_assigned_updated', [
			'isHandedOff',
			'status',
			'assignedTo',
			'updatedAt'
		])
		.index('by_needs_response', ['isHandedOff', 'status', 'awaitingAdminResponse'])
		.searchIndex('search_all', {
			searchField: 'searchText',
			filterFields: ['status', 'assignedTo', 'isHandedOff', 'awaitingAdminResponse']
		}),

	// Where each support message was sent from. The thread's own pageUrl
	// describes where the conversation began and cannot account for later routes.
	supportMessageContexts: defineTable({
		threadId: v.string(), // Reference to agent:threads, same id as supportThreads.threadId
		messageId: v.string(), // Reference to the agent component's message document
		pageUrl: v.string(), // Same-origin pathname, normalized before every write
		createdAt: v.number()
	}).index('by_thread', ['threadId']),

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
	// or reopens a closed ticket. Uses 4-minute debounce to accumulate multiple messages.
	// Timer resets if user sends more messages within the delay window, up to 15 minutes
	// after createdAt.
	pendingAdminNotifications: defineTable({
		threadId: v.string(), // Support thread ID
		isReopen: v.boolean(), // true = reopened ticket, false = new/handoff ticket
		notificationType: v.union(v.literal('newTickets'), v.literal('userReplies')), // Which preference toggle to use
		scheduledFor: v.number(), // Timestamp when notification should send
		messageIds: v.array(v.string()), // Accumulated message IDs to include
		scheduledFnId: v.optional(v.id('_scheduled_functions')), // For cancellation
		claimToken: v.optional(v.string()), // Identifies the send that claimed the row; cleared on re-arm and retry
		generation: v.optional(v.string()),
		claimLeaseExpiresAt: v.optional(v.number()),
		recoveryFnId: v.optional(v.id('_scheduled_functions')),
		retryCount: v.optional(v.number()), // Number of retry attempts (stops after 5)
		createdAt: v.number()
	}).index('by_thread', ['threadId']),

	supportNotificationReceipts: defineTable({
		notificationId: v.id('pendingAdminNotifications'),
		generation: v.string(),
		email: v.string()
	}).index('by_notificationId_and_generation_and_email', ['notificationId', 'generation', 'email']),

	// Saturation alert state for the global anonymous support rate limits, at
	// most one row per bucket. Written by the sampling cron in
	// support/rateLimitAlerts.ts only when a bucket changes state or alerts.
	supportRateLimitAlerts: defineTable({
		bucket: vAnonymousRateLimitBucket,
		lowSince: v.optional(v.number()), // First sample at or past the threshold in the current run of low samples
		alertedAt: v.optional(v.number()) // Last alert, for the cooldown
	}).index('by_bucket', ['bucket']),

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

	// One durable outcome per app-owned incident key and Better Auth user.
	// The exact index read and component enqueue share the caller's mutation.
	founderIncidentEmails: defineTable(founderIncidentEmailFields)
		.index('by_incident_and_user', ['incident', 'userId'])
		.index('by_email_id', ['emailId']),

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
		lastMessageAt: v.optional(v.number()),
		sidebarActivityAt: v.optional(v.number())
	})
		// eslint-disable-next-line @convex-dev/no-duplicate-indexes -- Keep creation ordering available for reader rollback; by_user_warm groups by isWarm first
		.index('by_user', ['userId'])
		.index('by_thread', ['threadId'])
		.index('by_user_warm', ['userId', 'isWarm'])
		.index('by_userId_and_sidebarActivityAt', ['userId', 'sidebarActivityAt']),

	// One row per AI chat message a user sent, written in the sending mutation.
	// Customer journeys count these instead of reading the agent component.
	aiChatMessageReceipts: defineTable({
		userId: v.string() // Better Auth user ID
	}).index('by_user', ['userId']),

	aiChatHistoryMigration: defineTable({
		version: v.literal(1),
		status: v.union(v.literal('running'), v.literal('complete')),
		cursor: v.union(v.string(), v.null()),
		processed: v.number(),
		scheduledFnId: v.optional(v.id('_scheduled_functions'))
	}),

	// Per-LLM-operation usage + cost. One row per call (single-shot) or per
	// assistant turn (agent). costUsd is authoritative and stamped at write time
	// (never recomputed at query time). Write-only like emailEvents until a
	// billing/admin query is added on by_user_at.
	aiUsage: defineTable({
		userId: v.optional(v.string()), // Better Auth _id, anon_* id, or absent
		feature: aiUsageFeatureValidator,
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
		.index('by_feature_at', ['feature', 'at']),

	journeyCaptureStarts

	// Note: The agent component automatically creates the following tables:
	// - agent:threads - Conversation threads for customer support
	// - agent:messages - Messages within threads (separate from demo messages table)
	// - agent:streamingDeltas - Real-time streaming chunks
	// - agent:embeddings - Vector embeddings for semantic search
});
