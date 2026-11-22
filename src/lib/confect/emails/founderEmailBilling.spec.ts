import { FunctionSpec, GroupSpec } from '@confect/core';
import type {
	resolveFounderCancellationBilling,
	resolveFounderFeedbackBilling
} from './founderEmailBilling';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.convexInternalAction<typeof resolveFounderCancellationBilling>()(
			'resolveFounderCancellationBilling'
		)
	)
	.addFunction(
		FunctionSpec.convexInternalAction<typeof resolveFounderFeedbackBilling>()(
			'resolveFounderFeedbackBilling'
		)
	);
