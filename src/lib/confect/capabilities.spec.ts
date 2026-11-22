import { FunctionSpec, GroupSpec } from '@confect/core';
import type { getUsability } from './capabilities';

export default GroupSpec.make().addFunction(
	FunctionSpec.convexPublicQuery<typeof getUsability>()('getUsability')
);
