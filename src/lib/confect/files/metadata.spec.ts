import { FunctionSpec, GroupSpec } from '@confect/core';
import type { storeFileMetadata } from './metadata';

export default GroupSpec.make().addFunction(
	FunctionSpec.convexInternalMutation<typeof storeFileMetadata>()('storeFileMetadata')
);
