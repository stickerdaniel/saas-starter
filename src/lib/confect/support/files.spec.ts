import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { RateLimitedCodec } from '../errorCodecs';
import VisitorAccess from '../middleware/VisitorAccess.spec';
import {
	AttachmentTextArgsSchema,
	AttachmentTextSchema,
	RegisteredUploadSchema,
	SupportOwnerArgsSchema,
	UploadRegistrationArgsSchema,
	UploadUrlSchema
} from './schemas';

export default GroupSpec.make()
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
			error: () => RateLimitedCodec
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
			returns: () => RegisteredUploadSchema
		})
	);
