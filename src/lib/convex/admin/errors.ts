import { ConvexError } from 'convex/values';

export const ADMIN_ERROR_CODES = {
	accessRequired: 'ADMIN_ACCESS_REQUIRED',
	cannotChangeOwnRole: 'ADMIN_CANNOT_CHANGE_OWN_ROLE',
	userNotFound: 'ADMIN_USER_NOT_FOUND',
	lastAdmin: 'ADMIN_LAST_ADMIN',
	seedAdminExists: 'ADMIN_ALREADY_EXISTS'
} as const;

export type AdminErrorCode = (typeof ADMIN_ERROR_CODES)[keyof typeof ADMIN_ERROR_CODES];

export function createAdminError(
	code: AdminErrorCode,
	data: Record<string, string | number | boolean | null> = {}
) {
	return new ConvexError({ code, ...data });
}
