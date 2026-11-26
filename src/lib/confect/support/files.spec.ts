import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { FileRefusalCodec, RateLimitedCodec, SupportRefusalCodec } from '../errorCodecs';
import VisitorAccess from '../middleware/VisitorAccess.spec';
import { AttachmentTextArgsSchema, SupportOwnerArgsSchema } from './schemas';
import {
	AttachmentTextSchema,
	RegisteredUploadSchema,
	UploadRegistrationArgsSchema,
	UploadUrlSchema
} from '../files/schemas';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'authorizeUpload',
			args: () => SupportOwnerArgsSchema.fields,
			returns: () => Schema.String,
			error: () => Schema.Union([RateLimitedCodec, SupportRefusalCodec])
		}).middleware(VisitorAccess)
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'checkPreviewAccess',
			args: () => SupportOwnerArgsSchema.fields,
			returns: () => Schema.Null,
			error: () => RateLimitedCodec
		}).middleware(VisitorAccess)
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'generateUploadUrl',
			args: () => SupportOwnerArgsSchema.fields,
			returns: () => UploadUrlSchema,
			error: () => FileRefusalCodec
		}).middleware(VisitorAccess)
	)
	.addFunction(
		FunctionSpec.publicAction({
			name: 'getAttachmentText',
			args: () => AttachmentTextArgsSchema.fields,
			returns: () => AttachmentTextSchema,
			error: () => RateLimitedCodec
		})
	)
	.addFunction(
		FunctionSpec.publicAction({
			name: 'saveUploadedFile',
			args: () => UploadRegistrationArgsSchema.fields,
			returns: () => RegisteredUploadSchema,
			error: () => FileRefusalCodec
		})
	);
