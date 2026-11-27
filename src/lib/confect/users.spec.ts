import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { UnauthenticatedCodec } from './errorCodecs';
import RequireUser from './middleware/RequireUser.spec';
import { BetterAuthUserId, BetterAuthUserSchema } from './schemas/betterAuth';

const Viewer = Schema.Struct({
	_id: BetterAuthUserId,
	_creationTime: Schema.Number,
	...BetterAuthUserSchema.fields
});

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'dismissPasskeyNudge',
			args: () => ({}),
			returns: () => Schema.Null
		}).middleware(RequireUser)
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'getPasskeyNudgeDismissal',
			args: () => ({}),
			returns: () => Schema.Number
		}).middleware(RequireUser)
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'hasPassword',
			args: () => ({}),
			returns: () => Schema.Boolean
		}).middleware(RequireUser)
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'setPassword',
			args: () => ({ newPassword: Schema.String }),
			returns: () =>
				Schema.Struct({
					ok: Schema.Boolean,
					code: Schema.optional(Schema.String),
					retryAfter: Schema.optional(Schema.Number)
				})
		}).middleware(RequireUser)
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'viewer',
			args: () => ({}),
			returns: () => Viewer
		}).middleware(RequireUser)
	)
	.addFunction(
		FunctionSpec.internalQuery({
			name: 'viewerAs',
			args: () => ({ userId: Schema.String }),
			returns: () => Viewer,
			error: () => UnauthenticatedCodec
		})
	);
