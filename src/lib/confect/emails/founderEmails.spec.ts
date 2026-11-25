import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import {
	FounderCancellationSendArgsSchema,
	FounderEmailSendArgsSchema,
	FounderFeedbackSendArgsSchema,
	PersonalEmailSuppressionArgsSchema
} from './founderEmailTypes';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'recordFounderEmailSendFailure',
			args: () => FounderEmailSendArgsSchema.fields,
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'sendFounderCancellationEmail',
			args: () => FounderCancellationSendArgsSchema.fields,
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'sendFounderFeedbackEmail',
			args: () => FounderFeedbackSendArgsSchema.fields,
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'setPersonalEmailSuppression',
			args: () => PersonalEmailSuppressionArgsSchema.fields,
			returns: () => Schema.Null
		})
	);
