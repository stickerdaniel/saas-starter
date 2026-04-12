import { v } from 'convex/values';

/**
 * Canonical field definitions for the supportThreads table.
 *
 * Used by both schema.ts (defineTable) and admin query return validators (v.object).
 * Adding a field here automatically updates both — no validator drift.
 */
export const supportThreadFields = {
	threadId: v.string(), // Reference to agent:threads
	userId: v.optional(v.string()), // Denormalized for quick lookups
	isWarm: v.optional(v.boolean()), // true = pre-warmed empty support thread awaiting first message
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
	lastMessageAt: v.optional(v.number()), // Timestamp of the latest non-tool successful message
	lastMessageRole: v.optional(
		v.union(v.literal('user'), v.literal('assistant'), v.literal('tool'), v.literal('system'))
	),
	lastAgentName: v.optional(v.string()),
	userName: v.optional(v.string()), // From user table
	userEmail: v.optional(v.string()), // From user table

	// Email notification settings
	notificationEmail: v.optional(v.string()), // Email to notify on admin response
	notificationSentAt: v.optional(v.number()) // Last notification timestamp (for 30-min cooldown)
};
