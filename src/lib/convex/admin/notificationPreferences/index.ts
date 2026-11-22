/**
 * Admin Notification Preferences Module
 *
 * Manages per-recipient notification preferences for admin users and custom emails.
 */

export {
	getJourneyRecipients,
	getNotificationRecipientCount,
	getRecipientsForNotificationType,
	listNotificationRecipients,
	resolveNotificationRecipientsLastPage
} from './queries';
export {
	addCustomEmail,
	removeCustomEmail,
	syncAllAdminPreferences,
	updatePreference,
	updatePreferences
} from './mutations';
