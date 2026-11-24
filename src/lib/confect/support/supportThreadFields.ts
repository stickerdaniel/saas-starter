import { SchemaToValidator } from '@confect/core';
import * as Schema from 'effect/Schema';
import { Id } from '../_generated/id';

export const SupportThreadStatusSchema = Schema.Literals(['open', 'done']);

export const SupportThreadPrioritySchema = Schema.Literals(['low', 'medium', 'high']);

export const SupportThreadSchema = Schema.Struct({
	// Reference to agent:threads
	threadId: Schema.String,
	// Denormalized for quick lookups; every write path sets it (auth or anon_* owner)
	userId: Schema.String,
	// true = pre-warmed empty support thread awaiting first message
	isWarm: Schema.optional(Schema.Boolean),
	status: SupportThreadStatusSchema,
	// true = human-only mode, undefined/false = AI responds
	isHandedOff: Schema.optional(Schema.Boolean),
	// true = user waiting for reply, false = admin has responded
	awaitingAdminResponse: Schema.optional(Schema.Boolean),
	// Admin user ID (for tracking, not AI control)
	assignedTo: Schema.optional(Schema.String),
	priority: Schema.optional(SupportThreadPrioritySchema),
	dueDate: Schema.optional(Schema.Number),
	// URL where user started chat
	pageUrl: Schema.optional(Schema.String),
	createdAt: Schema.Number,
	updatedAt: Schema.Number,

	// Denormalized search fields (for server-side full-text search)
	// Combined: title | summary | lastMessage | userName | userEmail
	searchText: Schema.optional(Schema.String),
	// From agent:threads
	title: Schema.optional(Schema.String),
	// From agent:threads
	summary: Schema.optional(Schema.String),
	// From agent:messages (truncated to 500 chars)
	lastMessage: Schema.optional(Schema.String),
	// Timestamp of the latest non-tool successful message
	lastMessageAt: Schema.optional(Schema.Number),
	lastMessageRole: Schema.optional(Schema.Literals(['user', 'assistant', 'tool', 'system'])),
	lastAgentName: Schema.optional(Schema.String),
	// When the owner first wrote in this thread: an ordinary message or the
	// handoff request. Set once, never by creation, prewarm or replies.
	firstUserMessageAt: Schema.optional(Schema.Number),
	// From user table
	userName: Schema.optional(Schema.String),
	// From user table
	userEmail: Schema.optional(Schema.String),

	// Human support read state
	lastAdminReplyAt: Schema.optional(Schema.Number),
	lastAdminReplyMessageId: Schema.optional(Schema.String),
	userReadAt: Schema.optional(Schema.Number),
	hasUnreadAdminReply: Schema.optional(Schema.Boolean),
	/** Number of admin messages after the user's last read receipt. Optional
	 * during the Boolean-to-count compatibility window; an unread legacy thread
	 * without the field represents one unread message. */
	unreadAdminReplyCount: Schema.optional(Schema.Number),

	// Email notification settings
	// Email to notify on admin response
	notificationEmail: Schema.optional(Schema.String),
	// Last notification timestamp (for 30-min cooldown)
	notificationSentAt: Schema.optional(Schema.Number),

	// Empty-thread sweep state: undefined = candidate, queued = a check or retry
	// job owns it, retained = has messages, failed = gave up after the last attempt
	sweep: Schema.optional(Schema.Literals(['queued', 'retained', 'failed'])),
	// The owning job, so a cron run can settle a claim whose job ended
	sweepJobId: Schema.optional(Id('_scheduled_functions')),
	// Failed sweep attempts so far; the sweep gives up at its maximum
	sweepAttempts: Schema.optional(Schema.Number)
});

export const supportThreadFields = SchemaToValidator.compileTableSchema(SupportThreadSchema).fields;
