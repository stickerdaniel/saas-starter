import { FunctionSpec, GroupSpec } from '@confect/core';
import type {
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

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof cancelPendingNotification>()(
			'cancelPendingNotification'
		)
	)
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof claimNotificationForSending>()(
			'claimNotificationForSending'
		)
	)
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof deletePendingNotification>()(
			'deletePendingNotification'
		)
	)
	.addFunction(FunctionSpec.convexInternalQuery<typeof getMessageContents>()('getMessageContents'))
	.addFunction(
		FunctionSpec.convexInternalQuery<typeof getNotificationTargetEmails>()(
			'getNotificationTargetEmails'
		)
	)
	.addFunction(
		FunctionSpec.convexInternalQuery<typeof getRecentUserMessages>()('getRecentUserMessages')
	)
	.addFunction(FunctionSpec.convexInternalQuery<typeof getSupportThread>()('getSupportThread'))
	.addFunction(
		FunctionSpec.convexInternalQuery<typeof listLegacyNotificationClaims>()(
			'listLegacyNotificationClaims'
		)
	)
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof recoverNotificationClaim>()(
			'recoverNotificationClaim'
		)
	)
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof reschedulePendingNotification>()(
			'reschedulePendingNotification'
		)
	)
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof scheduleAdminNotification>()(
			'scheduleAdminNotification'
		)
	)
	.addFunction(
		FunctionSpec.convexInternalAction<typeof sendPendingAdminNotification>()(
			'sendPendingAdminNotification'
		)
	);
