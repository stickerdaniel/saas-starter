import { FunctionSpec, GroupSpec } from '@confect/core';
import type { continueErasure, erasePage } from './erasure';

export default GroupSpec.make()
	.addFunction(FunctionSpec.convexInternalMutation<typeof continueErasure>()('continueErasure'))
	.addFunction(FunctionSpec.convexInternalMutation<typeof erasePage>()('erasePage'));
