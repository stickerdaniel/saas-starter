import { FunctionSpec, GroupSpec } from '@confect/core';
import type { queueFounderIncidentEmail } from './founderIncidentSend';

export default GroupSpec.make().addFunction(
	FunctionSpec.convexInternalMutation<typeof queueFounderIncidentEmail>()(
		'queueFounderIncidentEmail'
	)
);
