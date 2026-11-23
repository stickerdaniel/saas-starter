import { PaginationOptions } from '@confect/core';
import * as Schema from 'effect/Schema';
import type { MessagesQueryResponse } from '../../../chat/core/types';
import { StreamArgs } from '../../schemas/agent';
import { SupportThreadSchema } from '../../support/supportThreadFields';

const SupportMetadataSchema = Schema.Struct({
	_id: Schema.String,
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
	paginationOpts: Schema.optionalKey(PaginationOptions.PaginationOptions)
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
	paginationOpts: PaginationOptions.PaginationOptions,
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
	paginationOpts: Schema.optionalKey(PaginationOptions.PaginationOptions)
});

export const InternalNotesSchema = Schema.Struct({
	page: Schema.mutable(
		Schema.Array(
			Schema.Struct({
				_id: Schema.String,
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
