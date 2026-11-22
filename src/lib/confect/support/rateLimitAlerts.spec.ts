import { FunctionSpec, GroupSpec } from '@confect/core';
import type { sampleAnonymousRateLimits } from './rateLimitAlerts';

export default GroupSpec.make().addFunction(
	FunctionSpec.convexInternalMutation<typeof sampleAnonymousRateLimits>()(
		'sampleAnonymousRateLimits'
	)
);
