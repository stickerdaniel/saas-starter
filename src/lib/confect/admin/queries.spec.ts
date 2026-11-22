import { FunctionSpec, GroupSpec } from '@confect/core';
import type { getDashboardMetrics, getUserCount, listUsers, resolveUsersLastPage } from './queries';

export default GroupSpec.make()
	.addFunction(FunctionSpec.convexPublicQuery<typeof getDashboardMetrics>()('getDashboardMetrics'))
	.addFunction(FunctionSpec.convexPublicQuery<typeof getUserCount>()('getUserCount'))
	.addFunction(FunctionSpec.convexPublicQuery<typeof listUsers>()('listUsers'))
	.addFunction(
		FunctionSpec.convexPublicQuery<typeof resolveUsersLastPage>()('resolveUsersLastPage')
	);
