import { FunctionSpec, GroupSpec } from '@confect/core';
import type {
	addCustomEmail,
	removeCustomEmail,
	syncAllAdminPreferences,
	updatePreference,
	updatePreferences
} from './mutations';
import type {
	getJourneyRecipients,
	getNotificationRecipientCount,
	getRecipientsForNotificationType,
	listNotificationRecipients,
	resolveNotificationRecipientsLastPage
} from './queries';

export default GroupSpec.make()
	.addFunction(FunctionSpec.convexPublicMutation<typeof addCustomEmail>()('addCustomEmail'))
	.addFunction(
		FunctionSpec.convexInternalQuery<typeof getJourneyRecipients>()('getJourneyRecipients')
	)
	.addFunction(
		FunctionSpec.convexPublicQuery<typeof getNotificationRecipientCount>()(
			'getNotificationRecipientCount'
		)
	)
	.addFunction(
		FunctionSpec.convexInternalQuery<typeof getRecipientsForNotificationType>()(
			'getRecipientsForNotificationType'
		)
	)
	.addFunction(
		FunctionSpec.convexPublicQuery<typeof listNotificationRecipients>()(
			'listNotificationRecipients'
		)
	)
	.addFunction(FunctionSpec.convexPublicMutation<typeof removeCustomEmail>()('removeCustomEmail'))
	.addFunction(
		FunctionSpec.convexPublicQuery<typeof resolveNotificationRecipientsLastPage>()(
			'resolveNotificationRecipientsLastPage'
		)
	)
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof syncAllAdminPreferences>()('syncAllAdminPreferences')
	)
	.addFunction(FunctionSpec.convexPublicMutation<typeof updatePreference>()('updatePreference'))
	.addFunction(FunctionSpec.convexPublicMutation<typeof updatePreferences>()('updatePreferences'));
