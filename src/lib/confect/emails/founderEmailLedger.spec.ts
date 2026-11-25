import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import {
	FounderEmailSendArgsSchema,
	FounderWelcomeArgsSchema,
	SentFounderWelcomeSchema
} from './founderEmailTypes';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.internalQuery({
			name: 'getSentFounderWelcome',
			args: () => FounderWelcomeArgsSchema.fields,
			returns: () => SentFounderWelcomeSchema
		})
	)
	.addFunction(
		FunctionSpec.internalQuery({
			name: 'isFounderEmailSendPending',
			args: () => FounderEmailSendArgsSchema.fields,
			returns: () => Schema.Boolean
		})
	);
