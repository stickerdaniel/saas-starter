import { FunctionSpec, GroupSpec } from '@confect/core';
import type { getActive, savePrompt, setActive } from './promptStore';

export default GroupSpec.make()
	.addFunction(FunctionSpec.convexInternalQuery<typeof getActive>()('getActive'))
	.addFunction(FunctionSpec.convexInternalMutation<typeof savePrompt>()('savePrompt'))
	.addFunction(FunctionSpec.convexInternalMutation<typeof setActive>()('setActive'));
