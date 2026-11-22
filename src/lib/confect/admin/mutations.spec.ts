import { FunctionSpec, GroupSpec } from '@confect/core';
import type {
	banUser,
	revokeUserSessions,
	seedFirstAdmin,
	setUserRole,
	unbanUser
} from './mutations';

export default GroupSpec.make()
	.addFunction(FunctionSpec.convexPublicMutation<typeof banUser>()('banUser'))
	.addFunction(FunctionSpec.convexPublicMutation<typeof revokeUserSessions>()('revokeUserSessions'))
	.addFunction(FunctionSpec.convexInternalMutation<typeof seedFirstAdmin>()('seedFirstAdmin'))
	.addFunction(FunctionSpec.convexPublicMutation<typeof setUserRole>()('setUserRole'))
	.addFunction(FunctionSpec.convexPublicMutation<typeof unbanUser>()('unbanUser'));
