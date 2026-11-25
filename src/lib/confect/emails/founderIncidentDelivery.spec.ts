import { FunctionSpec, GroupSpec } from '@confect/core';
import {
	FounderIncidentReconciliationSchema,
	FounderIncidentRecipientArgsSchema
} from './founderIncidentTypes';

export default GroupSpec.make().addFunction(
	FunctionSpec.internalMutation({
		name: 'reconcileFounderIncidentEmailDelivery',
		args: () => FounderIncidentRecipientArgsSchema.fields,
		returns: () => FounderIncidentReconciliationSchema
	})
);
