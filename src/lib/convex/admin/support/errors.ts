import { ConvexError } from 'convex/values';

export const ADMIN_SUPPORT_ERROR_CODES = {
	threadNotFound: 'ADMIN_SUPPORT_THREAD_NOT_FOUND',
	emptyMessage: 'ADMIN_SUPPORT_MESSAGE_EMPTY',
	messageTooLong: 'ADMIN_SUPPORT_MESSAGE_TOO_LONG',
	emptyNote: 'ADMIN_SUPPORT_NOTE_EMPTY'
} as const;

export type AdminSupportErrorCode =
	(typeof ADMIN_SUPPORT_ERROR_CODES)[keyof typeof ADMIN_SUPPORT_ERROR_CODES];

export function createAdminSupportError(
	code: AdminSupportErrorCode,
	data: Record<string, number | string> = {}
) {
	return new ConvexError({ code, ...data });
}
