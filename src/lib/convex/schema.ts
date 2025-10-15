import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { authTables } from '@convex-dev/auth/server';

export default defineSchema({
	...authTables,
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
		.index('by_timestamp', ['timestamp'])
});
