import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';

export default GroupSpec.make().addFunction(
	FunctionSpec.internalMutation({
		name: 'grantFileOwner',
		args: () => ({ fileId: Schema.String, ownerId: Schema.String }),
		returns: () => Schema.Null
	})
);
