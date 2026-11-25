import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import {
	FounderCancellationBillingArgsSchema,
	FounderFeedbackBillingArgsSchema
} from './founderEmailTypes';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.internalAction({
			name: 'resolveFounderCancellationBilling',
			args: () => FounderCancellationBillingArgsSchema.fields,
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.internalAction({
			name: 'resolveFounderFeedbackBilling',
			args: () => FounderFeedbackBillingArgsSchema.fields,
			returns: () => Schema.Null
		})
	);
