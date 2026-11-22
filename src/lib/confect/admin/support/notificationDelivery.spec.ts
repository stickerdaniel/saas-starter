import { FunctionSpec, GroupSpec } from '@confect/core';
import type { cleanupReceipts, enqueueRecipient } from './notificationDelivery';

export default GroupSpec.make()
	.addFunction(FunctionSpec.convexInternalMutation<typeof cleanupReceipts>()('cleanupReceipts'))
	.addFunction(FunctionSpec.convexInternalMutation<typeof enqueueRecipient>()('enqueueRecipient'));
