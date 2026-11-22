import { FunctionSpec, GroupSpec } from '@confect/core';
import type { deleteUnusedFiles } from './vacuum';

export default GroupSpec.make().addFunction(
	FunctionSpec.convexInternalMutation<typeof deleteUnusedFiles>()('deleteUnusedFiles')
);
