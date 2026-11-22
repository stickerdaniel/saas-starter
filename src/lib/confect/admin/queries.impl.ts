import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { getDashboardMetrics, getUserCount, listUsers, resolveUsersLastPage } from './queries';
import queries from './queries.spec';

export default GroupImpl.make(databaseSchema, queries).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, queries, 'getDashboardMetrics', getDashboardMetrics),
		FunctionImpl.make(databaseSchema, queries, 'getUserCount', getUserCount),
		FunctionImpl.make(databaseSchema, queries, 'listUsers', listUsers),
		FunctionImpl.make(databaseSchema, queries, 'resolveUsersLastPage', resolveUsersLastPage)
	]),
	GroupImpl.finalize
);
