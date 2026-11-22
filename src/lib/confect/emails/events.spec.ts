import { FunctionSpec, GroupSpec } from '@confect/core';
import type { handleEmailEvent } from './events';

export default GroupSpec.make().addFunction(
	FunctionSpec.convexInternalMutation<typeof handleEmailEvent>()('handleEmailEvent')
);
