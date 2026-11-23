import { SchemaToValidator } from '@confect/core';
import * as Schema from 'effect/Schema';
import { Id } from '../../_generated/id';
import type { MessagesQueryResponse } from '../../../chat/core/types';
import { StreamArgs } from '../../schemas/agent';
import { PaginationOpts } from '../../schemas/pagination';
import {
	SupportThreadPrioritySchema,
	SupportThreadSchema,
	SupportThreadStatusSchema
} from '../../support/supportThreadFields';

const SupportMetadataSchema = Schema.Struct({
	_id: Id('supportThreads'),
	_creationTime: Schema.Number,
	...SupportThreadSchema.fields
});

const threadFields = {
	_id: Schema.String,
	_creationTime: Schema.Number,
	userId: Schema.String,
	title: Schema.optional(Schema.String),
	summary: Schema.optional(Schema.String),
	status: Schema.Literals(['active', 'archived']),
	supportMetadata: SupportMetadataSchema
};

export const SupportPersonSchema = Schema.Struct({
	id: Schema.String,
	name: Schema.optional(Schema.String),
	email: Schema.optional(Schema.String),
	image: Schema.Union([Schema.String, Schema.Null])
});

export const ThreadListArgsSchema = Schema.Struct({
	filter: Schema.Union([
		Schema.Literal('all'),
		Schema.Literal('unassigned'),
		Schema.Struct({ assignedTo: Schema.String })
	]),
	status: Schema.optionalKey(Schema.Literals(['open', 'done'])),
	search: Schema.optionalKey(Schema.String),
	paginationOpts: Schema.optionalKey(PaginationOpts)
});

export const ThreadListSchema = Schema.Struct({
	page: Schema.mutable(
		Schema.Array(
			Schema.Struct({
				...threadFields,
				lastMessage: Schema.optional(Schema.String),
				lastMessageAt: Schema.optional(Schema.Number),
				userName: Schema.optional(Schema.String),
				userEmail: Schema.optional(Schema.String),
				userImage: Schema.optional(Schema.String)
			})
		)
	),
	isDone: Schema.Boolean,
	continueCursor: Schema.String
});

export const ThreadArgsSchema = Schema.Struct({ threadId: Schema.String });

export const ThreadDetailsSchema = Schema.Struct({
	...threadFields,
	assignedAdmin: Schema.optional(SupportPersonSchema),
	user: Schema.optional(SupportPersonSchema)
});

export const MessageRoutesSchema = Schema.mutable(
	Schema.Array(
		Schema.Struct({
			messageId: Schema.String,
			pageUrl: Schema.optional(Schema.String),
			appVersion: Schema.optional(Schema.String)
		})
	)
);

export const MessageListArgsSchema = Schema.Struct({
	threadId: Schema.String,
	paginationOpts: PaginationOpts,
	streamArgs: Schema.optionalKey(StreamArgs)
});

export const MessageListSchema: Schema.Codec<MessagesQueryResponse> = Schema.Any;

export const InternalUserNoteSchema = Schema.Struct({
	userId: Schema.String,
	adminUserId: Schema.String,
	content: Schema.String,
	createdAt: Schema.Number
});

export const InternalNotesArgsSchema = Schema.Struct({
	userId: Schema.String,
	paginationOpts: Schema.optionalKey(PaginationOpts)
});

export const InternalNotesSchema = Schema.Struct({
	page: Schema.mutable(
		Schema.Array(
			Schema.Struct({
				_id: Id('internalUserNotes'),
				_creationTime: Schema.Number,
				...InternalUserNoteSchema.fields,
				adminName: Schema.optional(Schema.String),
				adminEmail: Schema.optional(Schema.String)
			})
		)
	),
	isDone: Schema.Boolean,
	continueCursor: Schema.String
});

export const ThreadAssignmentArgsSchema = Schema.Struct({
	threadId: Schema.String,
	adminUserId: Schema.optional(Schema.String)
});

export const ThreadStatusArgsSchema = Schema.Struct({
	threadId: Schema.String,
	status: SupportThreadStatusSchema
});

export const ThreadPriorityArgsSchema = Schema.Struct({
	threadId: Schema.String,
	priority: Schema.optional(SupportThreadPrioritySchema)
});

export const AdminReplyArgsSchema = Schema.Struct({
	threadId: Schema.String,
	prompt: Schema.String,
	fileIds: Schema.optional(Schema.mutable(Schema.Array(Schema.String)))
});

export const InternalNoteArgsSchema = Schema.Struct({
	userId: Schema.String,
	content: Schema.String
});

export const NotificationMessagesSchema = Schema.mutable(
	Schema.Array(Schema.Struct({ text: Schema.String, timestamp: Schema.String }))
);

export const notificationMessagesValidator = SchemaToValidator.compileSchema(
	NotificationMessagesSchema
);

export const RecipientEnqueueArgsSchema = Schema.Struct({
	notificationId: Id('pendingAdminNotifications'),
	generation: Schema.String,
	claimToken: Schema.String,
	email: Schema.String,
	isReopen: Schema.Boolean,
	isBareHandoff: Schema.Boolean,
	userName: Schema.String,
	messages: NotificationMessagesSchema,
	threadId: Schema.String
});

export const ReceiptCleanupArgsSchema = Schema.Struct({
	notificationId: Id('pendingAdminNotifications'),
	cursor: Schema.Union([Schema.String, Schema.Null])
});

export const AdminNotificationTypeSchema = Schema.Literals(['newTickets', 'userReplies']);

const pendingNotificationId = Id('pendingAdminNotifications');
const strings = Schema.mutable(Schema.Array(Schema.String));

export const NotificationScheduleArgsSchema = Schema.Struct({
	threadId: Schema.String,
	messageIds: strings,
	isReopen: Schema.Boolean,
	notificationType: AdminNotificationTypeSchema
});

export const NotificationSendArgsSchema = Schema.Struct({ notificationId: pendingNotificationId });

export const NotificationClaimArgsSchema = Schema.Struct({
	notificationId: pendingNotificationId,
	issueToken: Schema.optional(Schema.Boolean),
	receiptProtocol: Schema.optional(Schema.Literal(1))
});

export const NotificationClaimSchema = Schema.NullOr(
	Schema.Struct({
		threadId: Schema.String,
		messageIds: strings,
		isReopen: Schema.Boolean,
		notificationType: AdminNotificationTypeSchema,
		retryCount: Schema.Number,
		claimToken: Schema.String,
		generation: Schema.String,
		hadEnqueue: Schema.Boolean
	})
);

export const SupportThreadDocSchema = Schema.NullOr(SupportMetadataSchema);

export const NotificationOwnershipArgsSchema = Schema.Struct({
	notificationId: pendingNotificationId,
	claimToken: Schema.optional(Schema.String)
});

export const NotificationRescheduleArgsSchema = Schema.Struct({
	notificationId: pendingNotificationId,
	claimToken: Schema.optional(Schema.String),
	delayMs: Schema.optional(Schema.Number)
});

export const NotificationRecoveryArgsSchema = Schema.Struct({
	notificationId: pendingNotificationId,
	generation: Schema.String,
	claimToken: Schema.String,
	deadline: Schema.Number
});

export const LegacyClaimsArgsSchema = Schema.Struct({ paginationOpts: PaginationOpts });

export const LegacyClaimsSchema = Schema.Struct({
	page: Schema.mutable(Schema.Array(pendingNotificationId)),
	continueCursor: Schema.String,
	isDone: Schema.Boolean
});

export const TargetEmailsArgsSchema = Schema.Struct({
	assignedTo: Schema.optional(Schema.String),
	notificationType: AdminNotificationTypeSchema
});

export const MessageContentsArgsSchema = Schema.Struct({ messageIds: strings });

export const RecentUserMessagesArgsSchema = Schema.Struct({
	threadId: Schema.String,
	limit: Schema.optional(Schema.Number)
});

export const StringListSchema = strings;
