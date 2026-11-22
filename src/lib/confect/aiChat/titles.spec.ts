import { FunctionSpec, GroupSpec } from '@confect/core';
import type { generateThreadTitle } from './titles';

export default GroupSpec.make().addFunction(
	FunctionSpec.convexInternalAction<typeof generateThreadTitle>()('generateThreadTitle')
);
