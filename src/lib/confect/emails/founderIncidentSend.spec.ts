import { FunctionSpec, GroupSpec } from '@confect/core';
import { FounderIncidentRefusalCodec } from '../errorCodecs';
import {
	FounderIncidentQueueResultSchema,
	FounderIncidentRecipientArgsSchema
} from './founderIncidentTypes';

export default GroupSpec.make().addFunction(
	FunctionSpec.internalMutation({
		name: 'queueFounderIncidentEmail',
		args: () => FounderIncidentRecipientArgsSchema.fields,
		returns: () => FounderIncidentQueueResultSchema,
		error: () => FounderIncidentRefusalCodec
	})
);
