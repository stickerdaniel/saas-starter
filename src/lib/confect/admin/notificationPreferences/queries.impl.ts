import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../_generated/schema';
import {
	getJourneyRecipients,
	getNotificationRecipientCount,
	getRecipientsForNotificationType,
	listNotificationRecipients,
	resolveNotificationRecipientsLastPage
} from './queries';
import queries from './queries.spec';

export default GroupImpl.make(databaseSchema, queries).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, queries, 'getJourneyRecipients', getJourneyRecipients),
		FunctionImpl.make(
			databaseSchema,
			queries,
			'getNotificationRecipientCount',
			getNotificationRecipientCount
		),
		FunctionImpl.make(
			databaseSchema,
			queries,
			'getRecipientsForNotificationType',
			getRecipientsForNotificationType
		),
		FunctionImpl.make(
			databaseSchema,
			queries,
			'listNotificationRecipients',
			listNotificationRecipients
		),
		FunctionImpl.make(
			databaseSchema,
			queries,
			'resolveNotificationRecipientsLastPage',
			resolveNotificationRecipientsLastPage
		)
	]),
	GroupImpl.finalize
);
