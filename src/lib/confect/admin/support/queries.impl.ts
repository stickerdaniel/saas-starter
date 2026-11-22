import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../_generated/schema';
import {
	getAwaitingResponseCount,
	getThreadForAdmin,
	listAdmins,
	listInternalUserNotes,
	listMessageRoutesForAdmin,
	listMessagesForAdmin,
	listThreadsForAdmin
} from './queries';
import queries from './queries.spec';

export default GroupImpl.make(databaseSchema, queries).pipe(
	Layer.provide([
		FunctionImpl.make(
			databaseSchema,
			queries,
			'getAwaitingResponseCount',
			getAwaitingResponseCount
		),
		FunctionImpl.make(databaseSchema, queries, 'getThreadForAdmin', getThreadForAdmin),
		FunctionImpl.make(databaseSchema, queries, 'listAdmins', listAdmins),
		FunctionImpl.make(databaseSchema, queries, 'listInternalUserNotes', listInternalUserNotes),
		FunctionImpl.make(
			databaseSchema,
			queries,
			'listMessageRoutesForAdmin',
			listMessageRoutesForAdmin
		),
		FunctionImpl.make(databaseSchema, queries, 'listMessagesForAdmin', listMessagesForAdmin),
		FunctionImpl.make(databaseSchema, queries, 'listThreadsForAdmin', listThreadsForAdmin)
	]),
	GroupImpl.finalize
);
