import type { Agent } from '@convex-dev/agent';
import { vMessageDoc } from '@convex-dev/agent/validators';
import { validate } from 'convex-helpers/validators';
import { v } from 'convex/values';
import * as Schema from 'effect/Schema';
import { Id } from '../_generated/id';
import { StreamArgs } from '../schemas/agent';
import { PaginationOpts } from '../schemas/pagination';

export const SupportOwnerArgsSchema = Schema.Struct({
	anonymousUserId: Schema.optional(Schema.String)
});

export const ThreadReadArgsSchema = Schema.Struct({
	threadId: Schema.String,
	anonymousUserId: Schema.optional(Schema.String),
	readThroughMessageId: Schema.String
});

export const TicketMigrationArgsSchema = Schema.Struct({ anonymousUserId: Schema.String });

export const PromptLocaleArgsSchema = Schema.Struct({ locale: Schema.optional(Schema.String) });

export const SavePromptArgsSchema = Schema.Struct({
	systemPrompt: Schema.String,
	locale: Schema.optional(Schema.String),
	note: Schema.optional(Schema.String)
});

export const PromptActivationArgsSchema = Schema.Struct({
	id: Id('supportAgentPrompts'),
	active: Schema.Boolean
});

export const UploadRegistrationArgsSchema = Schema.Struct({
	storageId: Id('_storage'),
	uploadToken: Schema.String,
	filename: Schema.optional(Schema.String),
	mimeType: Schema.String,
	locale: Schema.optional(Schema.String),
	accessKey: Schema.optional(Schema.String),
	width: Schema.optional(Schema.Number),
	height: Schema.optional(Schema.Number)
});

export const RegisteredUploadSchema = Schema.Struct({
	fileId: Schema.String,
	storageId: Schema.String,
	url: Schema.String,
	filename: Schema.optional(Schema.String),
	isImage: Schema.Boolean
});

export const AttachmentTextArgsSchema = Schema.Struct({
	url: Schema.String,
	anonymousUserId: Schema.optional(Schema.String),
	locale: Schema.optional(Schema.String)
});

export const AttachmentTextSchema = Schema.Struct({
	text: Schema.String,
	truncated: Schema.Boolean
});

export const ThreadCreateArgsSchema = Schema.Struct({
	anonymousUserId: Schema.optional(Schema.String),
	title: Schema.optional(Schema.String),
	pageUrl: Schema.optional(Schema.String)
});

export const WarmThreadArgsSchema = Schema.Struct({
	anonymousUserId: Schema.optional(Schema.String),
	pageUrl: Schema.optional(Schema.String)
});

export const OwnedThreadSchema = Schema.Struct({
	threadId: Schema.String,
	notificationEmail: Schema.optional(Schema.String)
});

export const ThreadListArgsSchema = Schema.Struct({
	anonymousUserId: Schema.optional(Schema.String),
	paginationOpts: Schema.optional(PaginationOpts)
});

const AssignedAdminSchema = Schema.Struct({
	name: Schema.optional(Schema.String),
	image: Schema.Union([Schema.String, Schema.Null])
});

const AgentThreadStatusSchema = Schema.Literals(['active', 'archived']);

export const ThreadListSchema = Schema.Struct({
	page: Schema.mutable(
		Schema.Array(
			Schema.Struct({
				_id: Schema.String,
				_creationTime: Schema.Number,
				userId: Schema.String,
				title: Schema.optional(Schema.String),
				summary: Schema.optional(Schema.String),
				status: AgentThreadStatusSchema,
				lastAgentName: Schema.optional(Schema.String),
				lastMessageRole: Schema.optional(Schema.Literals(['user', 'assistant', 'tool', 'system'])),
				lastMessage: Schema.optional(Schema.String),
				lastMessageAt: Schema.optional(Schema.Number),
				isHandedOff: Schema.Boolean,
				hasUnreadAdminReply: Schema.Boolean,
				notificationEmail: Schema.optional(Schema.String),
				assignedAdmin: Schema.optional(AssignedAdminSchema)
			})
		)
	),
	isDone: Schema.Boolean,
	continueCursor: Schema.String
});

export const ThreadAccessArgsSchema = Schema.Struct({
	threadId: Schema.String,
	anonymousUserId: Schema.optional(Schema.String)
});

export const OwnerThreadSchema = Schema.Struct({
	_id: Schema.String,
	_creationTime: Schema.Number,
	userId: Schema.optional(Schema.String),
	title: Schema.optional(Schema.String),
	summary: Schema.optional(Schema.String),
	status: AgentThreadStatusSchema,
	isHandedOff: Schema.Boolean,
	lastAdminReplyAt: Schema.optional(Schema.Number),
	lastAdminReplyMessageId: Schema.optional(Schema.String),
	userReadAt: Schema.optional(Schema.Number),
	hasUnreadAdminReply: Schema.Boolean,
	notificationEmail: Schema.optional(Schema.String),
	assignedAdmin: Schema.optional(AssignedAdminSchema)
});

export const ThreadHandoffArgsSchema = Schema.Struct({
	threadId: Schema.String,
	anonymousUserId: Schema.optional(Schema.String),
	pageUrl: Schema.optional(Schema.String),
	appVersion: Schema.optional(Schema.String)
});

export const AdminAvatarsSchema = Schema.mutable(Schema.Array(AssignedAdminSchema));

export const NotificationEmailArgsSchema = Schema.Struct({
	threadId: Schema.String,
	email: Schema.String,
	anonymousUserId: Schema.optional(Schema.String)
});

export const ThreadMetadataArgsSchema = Schema.Struct({
	threadId: Schema.String,
	title: Schema.optional(Schema.String),
	summary: Schema.optional(Schema.String)
});

export const ThreadIdArgsSchema = Schema.Struct({ threadId: Schema.String });

export const ProfileSyncArgsSchema = Schema.Struct({
	userId: Schema.String,
	userName: Schema.optional(Schema.String),
	userEmail: Schema.optional(Schema.String),
	cursor: Schema.optional(Schema.String),
	endCursor: Schema.optional(Schema.String)
});

export const BackfillResultSchema = Schema.Struct({
	updated: Schema.Number,
	total: Schema.Number
});

export const SweepRunSchema = Schema.Struct({
	scheduled: Schema.Number,
	released: Schema.Number
});

export const SweepArgsSchema = Schema.Struct({ supportThreadId: Id('supportThreads') });

export const HandoffArgsSchema = Schema.Struct({
	threadId: Schema.String,
	acknowledge: Schema.optional(Schema.Boolean)
});

export const TurnErrorNameSchema = Schema.Literals([
	'AbortError',
	'TimeoutError',
	'APICallError',
	'other'
]);

export const UnansweredTurnSchema = Schema.Struct({
	threadId: Schema.String,
	promptMessageId: Schema.String,
	reason: Schema.Literals([
		'no_reply',
		'partial_reply',
		'retry_rate_limited',
		'handoff_without_reply',
		'job_failed',
		'job_missing'
	]),
	attempts: Schema.optional(Schema.Number),
	visibleText: Schema.optional(Schema.Boolean),
	errorName: Schema.optional(TurnErrorNameSchema),
	status: Schema.optional(Schema.Number)
});

export const SendMessageArgsSchema = Schema.Struct({
	threadId: Schema.String,
	prompt: Schema.String,
	anonymousUserId: Schema.optional(Schema.String),
	fileIds: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
	pageUrl: Schema.optional(Schema.String),
	appVersion: Schema.optional(Schema.String)
});

export const SentMessageSchema = Schema.Struct({ messageId: Schema.String });

export const AIResponseArgsSchema = Schema.Struct({
	threadId: Schema.String,
	promptMessageId: Schema.String,
	userId: Schema.optional(Schema.String)
});

export const TurnArgsSchema = Schema.Struct({
	threadId: Schema.String,
	promptMessageId: Schema.String
});

export const TurnOutcomeSchema = Schema.Struct({
	handedOff: Schema.Boolean,
	answered: Schema.Boolean,
	visibleText: Schema.Boolean
});

export const TurnWatchArgsSchema = Schema.Struct({
	threadId: Schema.String,
	promptMessageId: Schema.String,
	jobId: Id('_scheduled_functions'),
	checksLeft: Schema.Number
});

export const VisitorMessageListArgsSchema = Schema.Struct({
	threadId: Schema.String,
	anonymousUserId: Schema.optional(Schema.String),
	paginationOpts: PaginationOpts,
	streamArgs: Schema.optionalKey(StreamArgs)
});

export { MessageListSchema as VisitorMessageListSchema } from '../admin/support/schemas';

export const AssistantMessageArgsSchema = Schema.Struct({
	threadId: Schema.String,
	text: Schema.String
});

type SavedAssistantMessage = Awaited<ReturnType<Agent['saveMessage']>> | null;

const savedAssistantMessage = v.union(
	v.null(),
	v.object({ messageId: v.string(), message: vMessageDoc })
);

export const SavedAssistantMessageSchema = Schema.toType(
	Schema.Unknown.pipe(
		Schema.refine((value): value is SavedAssistantMessage => validate(savedAssistantMessage, value))
	)
);

export const FileMetadataBatchArgsSchema = Schema.Struct({
	urls: Schema.mutable(Schema.Array(Schema.String))
});

export const FileMetadataBatchSchema = Schema.Record(
	Schema.String,
	Schema.Struct({ width: Schema.optional(Schema.Number), height: Schema.optional(Schema.Number) })
);
