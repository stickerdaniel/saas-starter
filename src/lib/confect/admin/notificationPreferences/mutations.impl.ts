import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../_generated/schema';
import RequireAdminImpl from '../../middleware/RequireAdmin.impl';
import {
	addCustomRecipient,
	removeCustomRecipient,
	syncAllAdmins,
	updateManyPreferences,
	updateOnePreference
} from './mutations';
import mutations from './mutations.spec';

export default GroupImpl.make(databaseSchema, mutations).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, mutations, 'addCustomEmail', (args) =>
			Effect.gen(function* () {
				return yield* addCustomRecipient(args.email);
			})
		),
		FunctionImpl.make(databaseSchema, mutations, 'removeCustomEmail', (args) =>
			Effect.gen(function* () {
				return yield* removeCustomRecipient(args.email);
			})
		),
		FunctionImpl.make(databaseSchema, mutations, 'syncAllAdminPreferences', () =>
			Effect.gen(function* () {
				return yield* syncAllAdmins;
			})
		),
		FunctionImpl.make(databaseSchema, mutations, 'updatePreference', (args) =>
			Effect.gen(function* () {
				return yield* updateOnePreference(args);
			})
		),
		FunctionImpl.make(databaseSchema, mutations, 'updatePreferences', (args) =>
			Effect.gen(function* () {
				return yield* updateManyPreferences(args);
			})
		)
	]),
	Layer.provide(RequireAdminImpl),
	GroupImpl.finalize
);
