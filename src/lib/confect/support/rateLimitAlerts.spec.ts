import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';

export default GroupSpec.make().addFunction(
	FunctionSpec.internalMutation({
		name: 'sampleAnonymousRateLimits',
		args: () => ({}),
		returns: () => Schema.Null
	})
);
