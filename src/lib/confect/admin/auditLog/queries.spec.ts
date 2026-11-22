import { FunctionSpec, GroupSpec } from '@confect/core';
import type {
	getAuditLogCount,
	listAuditLogs,
	resolveAuditLogLastPage,
	resolveAuditLogUser
} from './queries';

export default GroupSpec.make()
	.addFunction(FunctionSpec.convexPublicQuery<typeof getAuditLogCount>()('getAuditLogCount'))
	.addFunction(FunctionSpec.convexPublicQuery<typeof listAuditLogs>()('listAuditLogs'))
	.addFunction(
		FunctionSpec.convexPublicQuery<typeof resolveAuditLogLastPage>()('resolveAuditLogLastPage')
	)
	.addFunction(FunctionSpec.convexPublicQuery<typeof resolveAuditLogUser>()('resolveAuditLogUser'));
