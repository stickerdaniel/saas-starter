import * as Schema from 'effect/Schema';
import { Id } from '../_generated/id';

export const UploadUrlSchema = Schema.Struct({
	uploadUrl: Schema.String,
	uploadToken: Schema.String,
	uploadTokenExpiresAt: Schema.Number,
	storageProvider: Schema.Literals(['convex', 'r2']),
	storageId: Schema.NullOr(Schema.String)
});

export const FileReferenceFields = {
	fileId: Schema.String,
	storageId: Schema.String
};

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

export const AttachmentTextSchema = Schema.Struct({
	text: Schema.String,
	truncated: Schema.Boolean
});
