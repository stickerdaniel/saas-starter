import { FunctionSpec, GroupSpec } from '@confect/core';
import type {
	addInternalUserNote,
	sendAdminReply,
	updateThreadAssignment,
	updateThreadPriority,
	updateThreadStatus
} from './mutations';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof addInternalUserNote>()('addInternalUserNote')
	)
	.addFunction(FunctionSpec.convexPublicMutation<typeof sendAdminReply>()('sendAdminReply'))
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof updateThreadAssignment>()('updateThreadAssignment')
	)
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof updateThreadPriority>()('updateThreadPriority')
	)
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof updateThreadStatus>()('updateThreadStatus')
	);
