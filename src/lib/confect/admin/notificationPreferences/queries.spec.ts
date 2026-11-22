import { FunctionSpec, GroupSpec } from '@confect/core';
import type {
	getJourneyRecipients,
	getNotificationRecipientCount,
	getRecipientsForNotificationType,
	listNotificationRecipients,
	resolveNotificationRecipientsLastPage
} from './queries';

export default GroupSpec.make()
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
	.addFunction(
		FunctionSpec.convexPublicQuery<typeof resolveNotificationRecipientsLastPage>()(
			'resolveNotificationRecipientsLastPage'
		)
	);
