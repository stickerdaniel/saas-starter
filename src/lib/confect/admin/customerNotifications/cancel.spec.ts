import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';

export default GroupSpec.make().addFunction(
	FunctionSpec.internalMutation({
		name: 'cancelUnsentEmails',
		args: () => ({ emailIds: Schema.Array(Schema.String) }),
		returns: () => Schema.Null
	})
);
