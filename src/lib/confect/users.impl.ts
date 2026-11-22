import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from './_generated/schema';
import {
	dismissPasskeyNudge,
	getPasskeyNudgeDismissal,
	hasPassword,
	setPassword,
	viewer
} from './users';
import users from './users.spec';

export default GroupImpl.make(databaseSchema, users).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, users, 'dismissPasskeyNudge', dismissPasskeyNudge),
		FunctionImpl.make(databaseSchema, users, 'getPasskeyNudgeDismissal', getPasskeyNudgeDismissal),
		FunctionImpl.make(databaseSchema, users, 'hasPassword', hasPassword),
		FunctionImpl.make(databaseSchema, users, 'setPassword', setPassword),
		FunctionImpl.make(databaseSchema, users, 'viewer', viewer)
	]),
	GroupImpl.finalize
);
