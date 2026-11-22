import { FunctionSpec, GroupSpec } from '@confect/core';
import type { getSentFounderWelcome, isFounderEmailSendPending } from './founderEmailLedger';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.convexInternalQuery<typeof getSentFounderWelcome>()('getSentFounderWelcome')
	)
	.addFunction(
		FunctionSpec.convexInternalQuery<typeof isFounderEmailSendPending>()(
			'isFounderEmailSendPending'
		)
	);
