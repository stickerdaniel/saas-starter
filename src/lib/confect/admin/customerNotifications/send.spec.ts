import { FunctionSpec, GroupSpec } from '@confect/core';
import type { enqueueRecipient, sendCancellation, sendNewCustomer } from './send';

export default GroupSpec.make()
	.addFunction(FunctionSpec.convexInternalMutation<typeof enqueueRecipient>()('enqueueRecipient'))
	.addFunction(FunctionSpec.convexInternalMutation<typeof sendCancellation>()('sendCancellation'))
	.addFunction(FunctionSpec.convexInternalMutation<typeof sendNewCustomer>()('sendNewCustomer'));
