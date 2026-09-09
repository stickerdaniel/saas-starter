import { ConvexError } from 'convex/values';

export const SUPPORT_ERROR_CODES = {
	authenticationRequired: 'SUPPORT_AUTHENTICATION_REQUIRED',
	threadNotFound: 'SUPPORT_THREAD_NOT_FOUND',
	threadForbidden: 'SUPPORT_THREAD_FORBIDDEN',
	messageNotFound: 'SUPPORT_MESSAGE_NOT_FOUND',
	messageEmpty: 'SUPPORT_MESSAGE_EMPTY',
	messageTooLong: 'SUPPORT_MESSAGE_TOO_LONG',
	notificationEmailInvalid: 'SUPPORT_NOTIFICATION_EMAIL_INVALID',
	anonymousUserInvalid: 'SUPPORT_ANONYMOUS_USER_INVALID'
} as const;

export type SupportErrorCode = (typeof SUPPORT_ERROR_CODES)[keyof typeof SUPPORT_ERROR_CODES];

export function createSupportError(
	code: SupportErrorCode,
	data: Record<string, number | string> = {}
) {
	return new ConvexError({ code, ...data });
}
