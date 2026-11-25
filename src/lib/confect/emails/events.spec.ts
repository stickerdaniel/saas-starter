import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { EmailEventArgsSchema } from './founderIncidentTypes';

export default GroupSpec.make().addFunction(
	FunctionSpec.internalMutation({
		name: 'handleEmailEvent',
		args: () => EmailEventArgsSchema.fields,
		returns: () => Schema.Null
	})
);
