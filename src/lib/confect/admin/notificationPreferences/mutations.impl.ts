import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../_generated/schema';
import {
	addCustomEmail,
	removeCustomEmail,
	syncAllAdminPreferences,
	updatePreference,
	updatePreferences
} from './mutations';
import mutations from './mutations.spec';

export default GroupImpl.make(databaseSchema, mutations).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, mutations, 'addCustomEmail', addCustomEmail),
		FunctionImpl.make(databaseSchema, mutations, 'removeCustomEmail', removeCustomEmail),
		FunctionImpl.make(
			databaseSchema,
			mutations,
			'syncAllAdminPreferences',
			syncAllAdminPreferences
		),
		FunctionImpl.make(databaseSchema, mutations, 'updatePreference', updatePreference),
		FunctionImpl.make(databaseSchema, mutations, 'updatePreferences', updatePreferences)
	]),
	GroupImpl.finalize
);
