import { FunctionSpec, GroupSpec } from '@confect/core';
import type {
	getAwaitingResponseCount,
	getThreadForAdmin,
	listAdmins,
	listInternalUserNotes,
	listMessageRoutesForAdmin,
	listMessagesForAdmin,
	listThreadsForAdmin
} from './queries';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.convexPublicQuery<typeof getAwaitingResponseCount>()('getAwaitingResponseCount')
	)
	.addFunction(FunctionSpec.convexPublicQuery<typeof getThreadForAdmin>()('getThreadForAdmin'))
	.addFunction(FunctionSpec.convexPublicQuery<typeof listAdmins>()('listAdmins'))
	.addFunction(
		FunctionSpec.convexPublicQuery<typeof listInternalUserNotes>()('listInternalUserNotes')
	)
	.addFunction(
		FunctionSpec.convexPublicQuery<typeof listMessageRoutesForAdmin>()('listMessageRoutesForAdmin')
	)
	.addFunction(
		FunctionSpec.convexPublicQuery<typeof listMessagesForAdmin>()('listMessagesForAdmin')
	)
	.addFunction(FunctionSpec.convexPublicQuery<typeof listThreadsForAdmin>()('listThreadsForAdmin'));
