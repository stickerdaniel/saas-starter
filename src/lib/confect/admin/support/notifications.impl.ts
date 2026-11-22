import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../_generated/schema';
import {
	cancelPendingNotification,
	claimNotificationForSending,
	deletePendingNotification,
	getMessageContents,
	getNotificationTargetEmails,
	getRecentUserMessages,
	getSupportThread,
	listLegacyNotificationClaims,
	recoverNotificationClaim,
	reschedulePendingNotification,
	scheduleAdminNotification,
	sendPendingAdminNotification
} from './notifications';
import notifications from './notifications.spec';

export default GroupImpl.make(databaseSchema, notifications).pipe(
	Layer.provide([
		FunctionImpl.make(
			databaseSchema,
			notifications,
			'cancelPendingNotification',
			cancelPendingNotification
		),
		FunctionImpl.make(
			databaseSchema,
			notifications,
			'claimNotificationForSending',
			claimNotificationForSending
		),
		FunctionImpl.make(
			databaseSchema,
			notifications,
			'deletePendingNotification',
			deletePendingNotification
		),
		FunctionImpl.make(databaseSchema, notifications, 'getMessageContents', getMessageContents),
		FunctionImpl.make(
			databaseSchema,
			notifications,
			'getNotificationTargetEmails',
			getNotificationTargetEmails
		),
		FunctionImpl.make(
			databaseSchema,
			notifications,
			'getRecentUserMessages',
			getRecentUserMessages
		),
		FunctionImpl.make(databaseSchema, notifications, 'getSupportThread', getSupportThread),
		FunctionImpl.make(
			databaseSchema,
			notifications,
			'listLegacyNotificationClaims',
			listLegacyNotificationClaims
		),
		FunctionImpl.make(
			databaseSchema,
			notifications,
			'recoverNotificationClaim',
			recoverNotificationClaim
		),
		FunctionImpl.make(
			databaseSchema,
			notifications,
			'reschedulePendingNotification',
			reschedulePendingNotification
		),
		FunctionImpl.make(
			databaseSchema,
			notifications,
			'scheduleAdminNotification',
			scheduleAdminNotification
		),
		FunctionImpl.make(
			databaseSchema,
			notifications,
			'sendPendingAdminNotification',
			sendPendingAdminNotification
		)
	]),
	GroupImpl.finalize
);
