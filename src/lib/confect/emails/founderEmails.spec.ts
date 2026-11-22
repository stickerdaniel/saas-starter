import { FunctionSpec, GroupSpec } from '@confect/core';
import type {
	recordFounderEmailSendFailure,
	sendFounderCancellationEmail,
	sendFounderFeedbackEmail,
	setPersonalEmailSuppression
} from './founderEmails';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof recordFounderEmailSendFailure>()(
			'recordFounderEmailSendFailure'
		)
	)
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof sendFounderCancellationEmail>()(
			'sendFounderCancellationEmail'
		)
	)
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof sendFounderFeedbackEmail>()(
			'sendFounderFeedbackEmail'
		)
	)
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof setPersonalEmailSuppression>()(
			'setPersonalEmailSuppression'
		)
	);
