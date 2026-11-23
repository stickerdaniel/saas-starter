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
import {
	countRecipients,
	findRecipientsLastPage,
	journeyRecipients,
	listRecipients,
	recipientsForType
} from './queries';
import index from './index.spec';

export default GroupImpl.make(databaseSchema, index).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, index, 'addCustomEmail', (args) =>
			Effect.gen(function* () {
				return yield* addCustomRecipient(args.email);
			})
		),
		FunctionImpl.make(databaseSchema, index, 'getJourneyRecipients', (args) =>
			Effect.gen(function* () {
				return yield* journeyRecipients(args.type);
			})
		),
		FunctionImpl.make(databaseSchema, index, 'getNotificationRecipientCount', (args) =>
			Effect.gen(function* () {
				return yield* countRecipients(args);
			})
		),
		FunctionImpl.make(databaseSchema, index, 'getRecipientsForNotificationType', (args) =>
			Effect.gen(function* () {
				return yield* recipientsForType(args.type);
			})
		),
		FunctionImpl.make(databaseSchema, index, 'listNotificationRecipients', (args) =>
			Effect.gen(function* () {
				return yield* listRecipients(args);
			})
		),
		FunctionImpl.make(databaseSchema, index, 'removeCustomEmail', (args) =>
			Effect.gen(function* () {
				return yield* removeCustomRecipient(args.email);
			})
		),
		FunctionImpl.make(databaseSchema, index, 'resolveNotificationRecipientsLastPage', (args) =>
			Effect.gen(function* () {
				return yield* findRecipientsLastPage(args);
			})
		),
		FunctionImpl.make(databaseSchema, index, 'syncAllAdminPreferences', () =>
			Effect.gen(function* () {
				return yield* syncAllAdmins;
			})
		),
		FunctionImpl.make(databaseSchema, index, 'updatePreference', (args) =>
			Effect.gen(function* () {
				return yield* updateOnePreference(args);
			})
		),
		FunctionImpl.make(databaseSchema, index, 'updatePreferences', (args) =>
			Effect.gen(function* () {
				return yield* updateManyPreferences(args);
			})
		)
	]),
	Layer.provide(RequireAdminImpl),
	GroupImpl.finalize
);
