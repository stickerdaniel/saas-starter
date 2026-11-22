import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../_generated/schema';
import {
	addInternalUserNote,
	sendAdminReply,
	updateThreadAssignment,
	updateThreadPriority,
	updateThreadStatus
} from './mutations';
import mutations from './mutations.spec';

export default GroupImpl.make(databaseSchema, mutations).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, mutations, 'addInternalUserNote', addInternalUserNote),
		FunctionImpl.make(databaseSchema, mutations, 'sendAdminReply', sendAdminReply),
		FunctionImpl.make(databaseSchema, mutations, 'updateThreadAssignment', updateThreadAssignment),
		FunctionImpl.make(databaseSchema, mutations, 'updateThreadPriority', updateThreadPriority),
		FunctionImpl.make(databaseSchema, mutations, 'updateThreadStatus', updateThreadStatus)
	]),
	GroupImpl.finalize
);
