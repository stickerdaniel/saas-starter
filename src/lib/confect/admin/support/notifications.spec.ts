import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import {
	LegacyClaimsArgsSchema,
	LegacyClaimsSchema,
	MessageContentsArgsSchema,
	NotificationClaimArgsSchema,
	NotificationClaimSchema,
	NotificationMessagesSchema,
	NotificationOwnershipArgsSchema,
	NotificationRecoveryArgsSchema,
	NotificationRescheduleArgsSchema,
	NotificationScheduleArgsSchema,
	NotificationSendArgsSchema,
	RecentUserMessagesArgsSchema,
	StringListSchema,
	SupportThreadDocSchema,
	TargetEmailsArgsSchema,
	ThreadArgsSchema
} from './schemas';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'cancelPendingNotification',
			args: () => ThreadArgsSchema.fields,
			returns: () => Schema.Boolean
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'claimNotificationForSending',
			args: () => NotificationClaimArgsSchema.fields,
			returns: () => NotificationClaimSchema
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'deletePendingNotification',
			args: () => NotificationOwnershipArgsSchema.fields,
			returns: () => Schema.Boolean
		})
	)
	.addFunction(
		FunctionSpec.internalQuery({
			name: 'getMessageContents',
			args: () => MessageContentsArgsSchema.fields,
			returns: () => NotificationMessagesSchema
		})
	)
	.addFunction(
		FunctionSpec.internalQuery({
			name: 'getNotificationTargetEmails',
			args: () => TargetEmailsArgsSchema.fields,
			returns: () => StringListSchema
		})
	)
	.addFunction(
		FunctionSpec.internalQuery({
			name: 'getRecentUserMessages',
			args: () => RecentUserMessagesArgsSchema.fields,
			returns: () => StringListSchema
		})
	)
	.addFunction(
		FunctionSpec.internalQuery({
			name: 'getSupportThread',
			args: () => ThreadArgsSchema.fields,
			returns: () => SupportThreadDocSchema
		})
	)
	.addFunction(
		FunctionSpec.internalQuery({
			name: 'listLegacyNotificationClaims',
			args: () => LegacyClaimsArgsSchema.fields,
			returns: () => LegacyClaimsSchema
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'recoverNotificationClaim',
			args: () => NotificationRecoveryArgsSchema.fields,
			returns: () => Schema.Boolean
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'reschedulePendingNotification',
			args: () => NotificationRescheduleArgsSchema.fields,
			returns: () => Schema.Boolean
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'scheduleAdminNotification',
			args: () => NotificationScheduleArgsSchema.fields,
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.internalAction({
			name: 'sendPendingAdminNotification',
			args: () => NotificationSendArgsSchema.fields,
			returns: () => Schema.Null
		})
	);
