import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../_generated/schema';
import {
	getAuditLogCount,
	listAuditLogs,
	resolveAuditLogLastPage,
	resolveAuditLogUser
} from './queries';
import queries from './queries.spec';

export default GroupImpl.make(databaseSchema, queries).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, queries, 'getAuditLogCount', getAuditLogCount),
		FunctionImpl.make(databaseSchema, queries, 'listAuditLogs', listAuditLogs),
		FunctionImpl.make(databaseSchema, queries, 'resolveAuditLogLastPage', resolveAuditLogLastPage),
		FunctionImpl.make(databaseSchema, queries, 'resolveAuditLogUser', resolveAuditLogUser)
	]),
	GroupImpl.finalize
);
