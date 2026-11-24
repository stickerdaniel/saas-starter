import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { Id } from '../_generated/id';
import {
	PromptActivationArgsSchema,
	PromptLocaleArgsSchema,
	SavePromptArgsSchema
} from './schemas';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.internalQuery({
			name: 'getActive',
			args: () => PromptLocaleArgsSchema.fields,
			returns: () => Schema.NullOr(Schema.String)
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'savePrompt',
			args: () => SavePromptArgsSchema.fields,
			returns: () => Id('supportAgentPrompts')
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'setActive',
			args: () => PromptActivationArgsSchema.fields,
			returns: () => Schema.Null
		})
	);
