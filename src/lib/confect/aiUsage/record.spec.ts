import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { UsageEventArgsSchema } from './schemas';

export default GroupSpec.make().addFunction(
	FunctionSpec.internalMutation({
		name: 'insert',
		args: () => UsageEventArgsSchema.fields,
		returns: () => Schema.Null
	})
);
