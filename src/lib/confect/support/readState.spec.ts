import { FunctionSpec, GroupSpec } from '@confect/core';
import type { hasUnreadAdminReply, markThreadRead, unreadAdminReplyCount } from './readState';

export default GroupSpec.make()
	.addFunction(FunctionSpec.convexPublicQuery<typeof hasUnreadAdminReply>()('hasUnreadAdminReply'))
	.addFunction(FunctionSpec.convexPublicMutation<typeof markThreadRead>()('markThreadRead'))
	.addFunction(
		FunctionSpec.convexPublicQuery<typeof unreadAdminReplyCount>()('unreadAdminReplyCount')
	);
