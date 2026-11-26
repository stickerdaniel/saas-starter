import * as Schema from 'effect/Schema';
import { Id } from '../_generated/id';
import { StreamArgs } from '../schemas/agent';
import { PaginationOpts } from '../schemas/pagination';

export const MigrationStartArgsSchema = Schema.Struct({ restart: Schema.optional(Schema.Boolean) });

export const MigrationProgressSchema = Schema.Struct({
	version: Schema.Literal(1),
	status: Schema.Literals(['running', 'complete']),
	processed: Schema.Number
});

export const MigrationPageArgsSchema = Schema.Struct({
	id: Id('aiChatHistoryMigration'),
	cursor: Schema.NullOr(Schema.String)
});

export const TitleArgsSchema = Schema.Struct({
	threadId: Schema.String,
	prompt: Schema.String,
	userId: Schema.optional(Schema.String)
});

export const ThreadListArgsSchema = Schema.Struct({ limit: Schema.optional(Schema.Number) });

export const ThreadListSchema = Schema.Struct({
	threads: Schema.mutable(
		Schema.Array(
			Schema.Struct({
				_id: Schema.String,
				title: Schema.optional(Schema.String),
				lastMessage: Schema.optional(Schema.String),
				lastMessageAt: Schema.Number
			})
		)
	),
	hasMore: Schema.Boolean
});

export const ThreadRefSchema = Schema.Struct({ threadId: Schema.String });

export const ThreadMetadataArgsSchema = Schema.Struct({
	threadId: Schema.String,
	lastMessage: Schema.optional(Schema.String),
	lastMessageAt: Schema.optional(Schema.Number)
});

export const ThreadTitleArgsSchema = Schema.Struct({
	threadId: Schema.String,
	title: Schema.String
});

export const StaleWarmSweepSchema = Schema.Struct({ deleted: Schema.Number });

export const MetadataBackfillSchema = Schema.Struct({
	updated: Schema.Number,
	total: Schema.Number
});

export const AttachmentTextArgsSchema = Schema.Struct({
	url: Schema.String,
	locale: Schema.optional(Schema.String)
});

export const SendMessageArgsSchema = Schema.Struct({
	threadId: Schema.String,
	prompt: Schema.String,
	fileIds: Schema.optional(Schema.mutable(Schema.Array(Schema.String)))
});

export const SentMessageSchema = Schema.Struct({ messageId: Schema.String, order: Schema.Number });

export const AIResponseArgsSchema = Schema.Struct({
	threadId: Schema.String,
	promptMessageId: Schema.String,
	userId: Schema.optional(Schema.String)
});

export const MessageListArgsSchema = Schema.Struct({
	threadId: Schema.String,
	paginationOpts: PaginationOpts,
	streamArgs: Schema.optionalKey(StreamArgs)
});

export const FileMetadataBatchArgsSchema = Schema.Struct({
	urls: Schema.mutable(Schema.Array(Schema.String))
});

export const FileMetadataBatchSchema = Schema.Record(
	Schema.String,
	Schema.Struct({ width: Schema.optional(Schema.Number), height: Schema.optional(Schema.Number) })
);
