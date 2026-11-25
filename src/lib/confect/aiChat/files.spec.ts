import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { FileRefusalCodec, UnauthenticatedCodec } from '../errorCodecs';
import RequireUser from '../middleware/RequireUser.spec';
import {
	AttachmentTextArgsSchema,
	AttachmentTextSchema,
	RegisteredUploadSchema,
	UploadRegistrationArgsSchema
} from './schemas';
import { UploadUrlSchema } from '../files/schemas';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'checkPreviewAccess',
			args: () => ({}),
			returns: () => Schema.Null,
			error: () => FileRefusalCodec
		}).middleware(RequireUser)
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'generateUploadUrl',
			args: () => ({}),
			returns: () => UploadUrlSchema,
			error: () => FileRefusalCodec
		}).middleware(RequireUser)
	)
	.addFunction(
		FunctionSpec.publicAction({
			name: 'getAttachmentText',
			args: () => AttachmentTextArgsSchema.fields,
			returns: () => AttachmentTextSchema,
			error: () => Schema.Union([FileRefusalCodec, UnauthenticatedCodec])
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'requireFileAccess',
			args: () => ({}),
			returns: () => Schema.Null
		}).middleware(RequireUser)
	)
	.addFunction(
		FunctionSpec.publicAction({
			name: 'saveUploadedFile',
			args: () => UploadRegistrationArgsSchema.fields,
			returns: () => RegisteredUploadSchema,
			error: () => UnauthenticatedCodec
		})
	);
