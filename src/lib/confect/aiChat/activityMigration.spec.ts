import { FunctionSpec, GroupSpec } from '@confect/core';
import type { runPage, start, status } from './activityMigration';

export default GroupSpec.make()
	.addFunction(FunctionSpec.convexInternalMutation<typeof runPage>()('runPage'))
	.addFunction(FunctionSpec.convexInternalMutation<typeof start>()('start'))
	.addFunction(FunctionSpec.convexInternalQuery<typeof status>()('status'));
