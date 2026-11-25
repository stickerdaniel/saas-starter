import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';

export default GroupSpec.make().addFunction(
	FunctionSpec.internalMutation({
		name: 'cleanupExpiredFiles',
		args: () => ({ limit: Schema.optional(Schema.Number) }),
		returns: () => Schema.Struct({ deletedCount: Schema.Number, hasMore: Schema.Boolean })
	})
);
