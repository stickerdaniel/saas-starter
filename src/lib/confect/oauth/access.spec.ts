import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';

export const VerifyArgs = Schema.Struct({
	token: Schema.String,
	audiences: Schema.Array(Schema.String)
});

export const VerifiedAccess = Schema.NullOr(
	Schema.Struct({
		userId: Schema.String,
		clientId: Schema.String,
		scopes: Schema.Array(Schema.String),
		expiresAt: Schema.Number,
		grant: Schema.String,
		audience: Schema.String,
		useRecordedAt: Schema.NullOr(Schema.Number)
	})
);

export default GroupSpec.make().addFunction(
	FunctionSpec.internalQuery({
		name: 'verify',
		args: () => VerifyArgs.fields,
		returns: () => VerifiedAccess
	})
);
