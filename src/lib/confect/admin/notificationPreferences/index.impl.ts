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
import {
	getJourneyRecipients,
	getNotificationRecipientCount,
	getRecipientsForNotificationType,
	listNotificationRecipients,
	resolveNotificationRecipientsLastPage
} from './queries';
import index from './index.spec';

export default GroupImpl.make(databaseSchema, index).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, index, 'addCustomEmail', addCustomEmail),
		FunctionImpl.make(databaseSchema, index, 'getJourneyRecipients', getJourneyRecipients),
		FunctionImpl.make(
			databaseSchema,
			index,
			'getNotificationRecipientCount',
			getNotificationRecipientCount
		),
		FunctionImpl.make(
			databaseSchema,
			index,
			'getRecipientsForNotificationType',
			getRecipientsForNotificationType
		),
		FunctionImpl.make(
			databaseSchema,
			index,
			'listNotificationRecipients',
			listNotificationRecipients
		),
		FunctionImpl.make(databaseSchema, index, 'removeCustomEmail', removeCustomEmail),
		FunctionImpl.make(
			databaseSchema,
			index,
			'resolveNotificationRecipientsLastPage',
			resolveNotificationRecipientsLastPage
		),
		FunctionImpl.make(databaseSchema, index, 'syncAllAdminPreferences', syncAllAdminPreferences),
		FunctionImpl.make(databaseSchema, index, 'updatePreference', updatePreference),
		FunctionImpl.make(databaseSchema, index, 'updatePreferences', updatePreferences)
	]),
	GroupImpl.finalize
);
