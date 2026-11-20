import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';
import { Id } from '../_generated/id';

export default Table.make(() =>
	Schema.Struct({
		threadId: Schema.String,
		userId: Schema.String,
		isWarm: Schema.optional(Schema.Boolean),
		status: Schema.Literals(['open', 'done']),
		isHandedOff: Schema.optional(Schema.Boolean),
		awaitingAdminResponse: Schema.optional(Schema.Boolean),
		assignedTo: Schema.optional(Schema.String),
		priority: Schema.optional(Schema.Literals(['low', 'medium', 'high'])),
		dueDate: Schema.optional(Schema.Number),
		pageUrl: Schema.optional(Schema.String),
		createdAt: Schema.Number,
		updatedAt: Schema.Number,
		searchText: Schema.optional(Schema.String),
		title: Schema.optional(Schema.String),
		summary: Schema.optional(Schema.String),
		lastMessage: Schema.optional(Schema.String),
		lastMessageAt: Schema.optional(Schema.Number),
		lastMessageRole: Schema.optional(Schema.Literals(['user', 'assistant', 'tool', 'system'])),
		lastAgentName: Schema.optional(Schema.String),
		firstUserMessageAt: Schema.optional(Schema.Number),
		userName: Schema.optional(Schema.String),
		userEmail: Schema.optional(Schema.String),
		lastAdminReplyAt: Schema.optional(Schema.Number),
		lastAdminReplyMessageId: Schema.optional(Schema.String),
		userReadAt: Schema.optional(Schema.Number),
		hasUnreadAdminReply: Schema.optional(Schema.Boolean),
		unreadAdminReplyCount: Schema.optional(Schema.Number),
		notificationEmail: Schema.optional(Schema.String),
		notificationSentAt: Schema.optional(Schema.Number),
		sweep: Schema.optional(Schema.Literals(['queued', 'retained', 'failed'])),
		sweepJobId: Schema.optional(Id('_scheduled_functions')),
		sweepAttempts: Schema.optional(Schema.Number)
	})
)
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
	});
