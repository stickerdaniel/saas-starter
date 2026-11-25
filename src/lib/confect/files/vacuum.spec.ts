import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';

export default GroupSpec.make().addFunction(
	FunctionSpec.internalMutation({
		name: 'deleteUnusedFiles',
		args: () => ({ cursor: Schema.optional(Schema.String) }),
		returns: () => Schema.Null
	})
);
