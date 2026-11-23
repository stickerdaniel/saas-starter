import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../_generated/schema';
import RequireAdminImpl from '../../middleware/RequireAdmin.impl';
import {
	countRecipients,
	findRecipientsLastPage,
	journeyRecipients,
	listRecipients,
	recipientsForType
} from './queries';
import queries from './queries.spec';

export default GroupImpl.make(databaseSchema, queries).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, queries, 'getJourneyRecipients', (args) =>
			Effect.gen(function* () {
				return yield* journeyRecipients(args.type);
			})
		),
		FunctionImpl.make(databaseSchema, queries, 'getNotificationRecipientCount', (args) =>
			Effect.gen(function* () {
				return yield* countRecipients(args);
			})
		),
		FunctionImpl.make(databaseSchema, queries, 'getRecipientsForNotificationType', (args) =>
			Effect.gen(function* () {
				return yield* recipientsForType(args.type);
			})
		),
		FunctionImpl.make(databaseSchema, queries, 'listNotificationRecipients', (args) =>
			Effect.gen(function* () {
				return yield* listRecipients(args);
			})
		),
		FunctionImpl.make(databaseSchema, queries, 'resolveNotificationRecipientsLastPage', (args) =>
			Effect.gen(function* () {
				return yield* findRecipientsLastPage(args);
			})
		)
	]),
	Layer.provide(RequireAdminImpl),
	GroupImpl.finalize
);
