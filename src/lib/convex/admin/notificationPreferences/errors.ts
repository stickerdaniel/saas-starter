import { ConvexError } from 'convex/values';

export const NOTIFICATION_EMAIL_ALREADY_EXISTS = 'notification_email_already_exists' as const;

export const NOTIFICATION_PREFERENCE_ERROR_CODES = {
	notFound: 'NOTIFICATION_PREFERENCE_NOT_FOUND',
	dormant: 'NOTIFICATION_PREFERENCE_DORMANT',
	invalidEmail: 'NOTIFICATION_EMAIL_INVALID',
	emailNotFound: 'NOTIFICATION_EMAIL_NOT_FOUND',
	adminRecipientRequired: 'NOTIFICATION_ADMIN_RECIPIENT_REQUIRED'
} as const;

export type NotificationPreferenceErrorCode =
	| typeof NOTIFICATION_EMAIL_ALREADY_EXISTS
	| (typeof NOTIFICATION_PREFERENCE_ERROR_CODES)[keyof typeof NOTIFICATION_PREFERENCE_ERROR_CODES];

export function createNotificationPreferenceError(code: NotificationPreferenceErrorCode) {
	return new ConvexError({ code });
}
