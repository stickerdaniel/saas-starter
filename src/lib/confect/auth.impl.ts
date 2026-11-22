import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from './_generated/schema';
import { getAvailableOAuthProviders, onCreate, onDelete, onUpdate } from './authServer';
import auth from './auth.spec';

export default GroupImpl.make(databaseSchema, auth).pipe(
	Layer.provide([
		FunctionImpl.make(
			databaseSchema,
			auth,
			'getAvailableOAuthProviders',
			getAvailableOAuthProviders
		),
		FunctionImpl.make(databaseSchema, auth, 'onCreate', onCreate),
		FunctionImpl.make(databaseSchema, auth, 'onDelete', onDelete),
		FunctionImpl.make(databaseSchema, auth, 'onUpdate', onUpdate)
	]),
	GroupImpl.finalize
);
