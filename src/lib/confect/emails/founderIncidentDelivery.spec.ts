import { FunctionSpec, GroupSpec } from '@confect/core';
import type { reconcileFounderIncidentEmailDelivery } from './founderIncidentDelivery';

export default GroupSpec.make().addFunction(
	FunctionSpec.convexInternalMutation<typeof reconcileFounderIncidentEmailDelivery>()(
		'reconcileFounderIncidentEmailDelivery'
	)
);
