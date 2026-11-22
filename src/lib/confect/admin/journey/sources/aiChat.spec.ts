import { FunctionSpec, GroupSpec } from '@confect/core';
import type { read } from './aiChat';

export default GroupSpec.make().addFunction(
	FunctionSpec.convexInternalQuery<typeof read>()('read')
);
