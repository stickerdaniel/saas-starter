import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'deleteStaleClients',
			args: () => ({ cursor: Schema.optional(Schema.String) }),
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'deleteExpiredTokens',
			args: () => ({}),
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'eraseUserGrants',
			args: () => ({ userId: Schema.String }),
			returns: () => Schema.Null
		})
	);
