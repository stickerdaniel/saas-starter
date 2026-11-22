import { FunctionSpec, GroupSpec } from '@confect/core';
import type { cancelUnsentEmails } from './cancel';

export default GroupSpec.make().addFunction(
	FunctionSpec.convexInternalMutation<typeof cancelUnsentEmails>()('cancelUnsentEmails')
);
