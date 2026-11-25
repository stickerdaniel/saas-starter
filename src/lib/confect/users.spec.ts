import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import RequireUser from './middleware/RequireUser.spec';
import { BetterAuthUserSchema } from './schemas/betterAuth';

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
			returns: () =>
				Schema.Struct({
					_id: Schema.String,
					_creationTime: Schema.Number,
					...BetterAuthUserSchema.fields
				})
		}).middleware(RequireUser)
	);
