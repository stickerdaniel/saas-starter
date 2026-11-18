import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { vEmailEvent } from '@convex-dev/resend';
import { supportThreadFields } from './support/supportThreadFields';
import { vAnonymousRateLimitBucket } from './support/rateLimitAlertFields';
import {
	founderIncidentDraftFields,
	founderIncidentEmailFields
} from './emails/founderIncidentTypes';
import { aiUsageFeatureValidator } from './aiUsage/feature';
import { journeyCaptureStarts } from './admin/journey/capture';
import { customerNotifications } from './admin/customerNotifications/ledger';

export default defineSchema({
	// The Better Auth component owns its tables (user, session, account, verification)
	passkeyNudgeDismissals: defineTable({
		userId: v.string(),
		deferredUntil: v.number()
	}).index('by_userId', ['userId']),

	// Demo messages for the dashboard billing demo
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

	// Resend webhook events. The table is write-only: inspect events in the Convex
	// dashboard. A query that needs them reads through by_email_id.
	emailEvents: defineTable({
		emailId: v.string(),
		eventType: v.string(), // 'email.delivered', 'email.bounced', etc.
		timestamp: v.number(),
		data: vEmailEvent
	}).index('by_email_id', ['emailId']),

	adminAuditLogs: defineTable({
		adminUserId: v.string(),
		action: v.union(
			v.literal('impersonate'),
			v.literal('stop_impersonation'),
			v.literal('ban_user'),
			v.literal('unban_user'),
			v.literal('revoke_sessions'),
			v.literal('set_role')
		),
		targetUserId: v.string(),
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

	// Notes about a user that only admins see
	internalUserNotes: defineTable({
		userId: v.string(), // Better Auth ID or anonymous ID (utils/anonymousUser.ts)
		adminUserId: v.string(),
		content: v.string(),
		createdAt: v.number()
	}).index('by_user', ['userId']),

	// Source of truth for support thread membership, access, and denormalized
	// list and search data. agent:threads stays generic conversation storage
	// shared across features.
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
		.index('by_sweep', ['sweep'])
		.searchIndex('search_all', {
			searchField: 'searchText',
			filterFields: ['status', 'assignedTo', 'isHandedOff', 'awaitingAdminResponse']
		}),

	// Where each support message was sent from, and which build the sender's tab
	// ran. The thread's own pageUrl describes where the conversation began and
	// cannot account for later routes. A row holds whichever of the two survived
	// normalization; rows written before appVersion existed carry only a route.
	supportMessageContexts: defineTable({
		threadId: v.string(), // Reference to agent:threads, same id as supportThreads.threadId
		messageId: v.string(), // Reference to the agent component's message document
		pageUrl: v.optional(v.string()), // Same-origin pathname, normalized before every write
		appVersion: v.optional(v.string()), // The tab's kit.version.name, normally a commit SHA
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

	adminSettings: defineTable({
		key: v.string(), // e.g. 'defaultSupportEmail'
		value: v.string(),
		updatedAt: v.number(),
		updatedBy: v.optional(v.string())
	}).index('by_key', ['key']),

	// Debounced admin notifications, one per thread (admin/support/notifications.ts)
	pendingAdminNotifications: defineTable({
		threadId: v.string(),
		isReopen: v.boolean(),
		notificationType: v.union(v.literal('newTickets'), v.literal('userReplies')), // Which preference toggle to use
		scheduledFor: v.number(),
		messageIds: v.array(v.string()),
		scheduledFnId: v.optional(v.id('_scheduled_functions')), // Unset while a send owns the claim
		claimToken: v.optional(v.string()), // Identifies the send that claimed the row; cleared on re-arm and retry
		generation: v.optional(v.string()),
		claimLeaseExpiresAt: v.optional(v.number()),
		recoveryFnId: v.optional(v.id('_scheduled_functions')),
		retryCount: v.optional(v.number()), // Capped by MAX_RETRY_COUNT
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

	// Per-recipient notification toggles. Auth triggers sync admin users, and
	// custom emails are added manually. A demoted admin's row stays dormant with
	// isAdminUser false.
	adminNotificationPreferences: defineTable({
		email: v.string(),
		userId: v.optional(v.string()), // Better Auth user ID (undefined for custom emails)
		isAdminUser: v.boolean(), // false = demoted or custom email

		notifyNewSupportTickets: v.boolean(),
		notifyUserReplies: v.boolean(), // Visitor messages on a handed-off thread
		notifyNewSignups: v.boolean(),
		// Added after rows already existed, so optional: a missing value means on.
		notifyNewCustomers: v.optional(v.boolean()), // First payments
		notifyCancellations: v.optional(v.boolean()), // Scheduled cancellations

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

	// Image dimensions for the attachment dialog. The agent component strips
	// unknown fields from file parts, so the dimensions live here.
	fileMetadata: defineTable({
		fileId: v.string(), // Reference to agent:files._id
		storageId: v.string(),
		url: v.optional(v.string()), // Agent component file URL, absent on legacy records
		width: v.optional(v.number()),
		height: v.optional(v.number()),
		createdAt: v.number()
	})
		.index('by_url', ['url'])
		// Used by the hourly file vacuum to delete metadata of purged files
		.index('by_storageId', ['storageId']),

	// Materialized user metrics, sharded over rows so concurrent sign-ups do not
	// conflict on one document. Auth triggers (onCreate, onUpdate) update them, so
	// a dashboard load does not fetch all users.
	dashboardCounters: defineTable({
		totalUsers: v.number(),
		adminCount: v.number(),
		bannedCount: v.number(),
		// Counter shard 0..15, see admin/counters.ts; absent on the legacy singleton.
		shard: v.optional(v.number())
	}).index('by_shard', ['shard']),

	// Personal welcome from a team member, sent at signup or at verification. The
	// configuration lives in adminSettings.
	founderWelcomeEmails: defineTable({
		userId: v.string(),
		signupEmail: v.string(),
		// Delay of the retired randomized welcome; only rows written before the
		// immediate send carry it.
		delayMs: v.optional(v.number()),
		status: v.union(
			v.literal('pending_verification'),
			v.literal('scheduled'),
			v.literal('sent'),
			v.literal('skipped')
		),
		scheduledFnId: v.optional(v.id('_scheduled_functions')),
		sentAt: v.optional(v.number()),
		// Resend component email id and rendered subject, written with the enqueue
		emailId: v.optional(v.string()),
		subject: v.optional(v.string()),
		skippedReason: v.optional(v.string()),
		createdAt: v.number()
	}).index('by_user', ['userId']),

	// Users opted out of the personal founder emails (welcome, feedback, cancellation),
	// at most one row each. Set by an operator with
	// emails/founderEmails:setPersonalEmailSuppression; all other mail still goes out.
	personalEmailSuppressions: defineTable({
		userId: v.string(),
		createdAt: v.number()
	}).index('by_user', ['userId']),

	// One row per founder feedback or cancellation email episode
	// (emails/founderEmails.ts). The feedback email is keyed `signup`, once per account;
	// a cancellation email by its cancellation's `canceledAt`. `recipientEmail` is the
	// address the row was opened for; the send skips a changed address.
	founderEmailSends: defineTable({
		userId: v.string(),
		email: v.union(v.literal('feedback'), v.literal('cancellation')),
		dedupeKey: v.string(),
		recipientEmail: v.string(),
		status: v.union(
			v.literal('pending_verification'),
			v.literal('scheduled'),
			v.literal('sent'),
			v.literal('skipped')
		),
		skippedReason: v.optional(v.string()),
		scheduledFnId: v.optional(v.id('_scheduled_functions')),
		sentAt: v.optional(v.number()),
		// Resend component email id and subject sent, written with the enqueue
		emailId: v.optional(v.string()),
		subject: v.optional(v.string()),
		createdAt: v.number()
	}).index('by_userId_and_email_and_dedupeKey', ['userId', 'email', 'dedupeKey']),

	founderIncidentDrafts: defineTable(founderIncidentDraftFields).index('by_incident', ['incident']),

	// One durable outcome per app-owned incident key and Better Auth user.
	// The exact index read and component enqueue share the caller's mutation.
	founderIncidentEmails: defineTable(founderIncidentEmailFields)
		.index('by_incident_and_user', ['incident', 'userId'])
		.index('by_email_id', ['emailId']),

	// Source of truth for AI chat membership and sidebar state. Denormalized fields
	// keep ctx.runQuery into generic agent tables off the hot path.
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

	journeyCaptureStarts,

	customerNotifications

	// The agent component owns agent:threads, agent:messages, agent:streamingDeltas,
	// and agent:embeddings. agent:messages is separate from the demo messages table.
});
