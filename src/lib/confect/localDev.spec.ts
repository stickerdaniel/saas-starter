import { FunctionSpec, GroupSpec } from '@confect/core';
import type { ensureSeededAdmin } from './localDev';

export default GroupSpec.make().addFunction(
	FunctionSpec.convexInternalMutation<typeof ensureSeededAdmin>()('ensureSeededAdmin')
);
