import { FunctionSpec, GroupSpec } from '@confect/core';
import type { admitObservation } from './admission';

export default GroupSpec.make().addFunction(
	FunctionSpec.convexInternalMutation<typeof admitObservation>()('admitObservation')
);
