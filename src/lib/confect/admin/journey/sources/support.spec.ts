import { FunctionSpec, GroupSpec } from '@confect/core';
import type { read } from './support';

export default GroupSpec.make().addFunction(
	FunctionSpec.convexInternalQuery<typeof read>()('read')
);
