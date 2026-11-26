import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { FileRefusalCodec, RateLimitedCodec } from './errorCodecs';
import { UploadUrlSchema } from './files/schemas';
import RequireUser from './middleware/RequireUser.spec';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'authorizeUpload',
			args: () => ({}),
			returns: () => Schema.String,
			error: () => RateLimitedCodec
		}).middleware(RequireUser)
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'finalizeProfileImage',
			args: () => ({ storageId: Schema.String, uploadToken: Schema.String }),
			returns: () => Schema.String,
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
		FunctionSpec.publicMutation({
			name: 'updateProfileImage',
			args: () => ({ storageId: Schema.String, uploadToken: Schema.String }),
			returns: () => Schema.String,
			error: () => FileRefusalCodec
		}).middleware(RequireUser)
	);
