import * as Schema from 'effect/Schema';
import { Id } from '../_generated/id';

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

export const UploadUrlSchema = Schema.Struct({
	uploadUrl: Schema.String,
	uploadToken: Schema.String,
	uploadTokenExpiresAt: Schema.Number,
	storageProvider: Schema.Literals(['convex', 'r2']),
	storageId: Schema.NullOr(Schema.String)
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
