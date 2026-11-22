import { FunctionSpec, GroupSpec } from '@confect/core';
import type { cleanupExpiredFiles } from './cleanup';

export default GroupSpec.make().addFunction(
	FunctionSpec.convexInternalMutation<typeof cleanupExpiredFiles>()('cleanupExpiredFiles')
);
