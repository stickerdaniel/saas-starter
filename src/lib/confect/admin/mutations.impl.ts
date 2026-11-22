import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { banUser, revokeUserSessions, seedFirstAdmin, setUserRole, unbanUser } from './mutations';
import mutations from './mutations.spec';

export default GroupImpl.make(databaseSchema, mutations).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, mutations, 'banUser', banUser),
		FunctionImpl.make(databaseSchema, mutations, 'revokeUserSessions', revokeUserSessions),
		FunctionImpl.make(databaseSchema, mutations, 'seedFirstAdmin', seedFirstAdmin),
		FunctionImpl.make(databaseSchema, mutations, 'setUserRole', setUserRole),
		FunctionImpl.make(databaseSchema, mutations, 'unbanUser', unbanUser)
	]),
	GroupImpl.finalize
);
