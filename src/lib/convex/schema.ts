import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { authTables } from '@convex-dev/auth/server';

export default defineSchema({
	...authTables,

	// Demo messages table (used in dashboard for billing demo)
	messages: defineTable({
		userId: v.id('users'),
		body: v.string()
	}),

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
		userId: v.optional(v.string()), // Auth subject (not document ID)
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
		.index('by_admin_email_id', ['adminEmailId'])

	// Note: The agent component automatically creates the following tables:
	// - agent:threads - Conversation threads for customer support
	// - agent:messages - Messages within threads (separate from demo messages table)
	// - agent:streamingDeltas - Real-time streaming chunks
	// - agent:embeddings - Vector embeddings for semantic search
});
