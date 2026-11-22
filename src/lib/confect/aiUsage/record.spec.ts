import { FunctionSpec, GroupSpec } from '@confect/core';
import type { insert } from './record';

export default GroupSpec.make().addFunction(
	FunctionSpec.convexInternalMutation<typeof insert>()('insert')
);
