import { isAPIError } from 'better-auth/api';
import { ConvexError } from 'convex/values';

export type AdminAuthErrorCode =
	| 'ADMIN_CANNOT_BAN_SELF'
	| 'ADMIN_USER_NOT_FOUND'
	| 'ADMIN_ACTION_NOT_ALLOWED'
	| 'ADMIN_AUTH_ACTION_FAILED';

export type AdminAuthOperation = 'ban_user' | 'unban_user' | 'revoke_user_sessions';

type ApiErrorBody = {
	code?: unknown;
};

const PROVIDER_CODE_MAP: Record<string, AdminAuthErrorCode> = {
	YOU_CANNOT_BAN_YOURSELF: 'ADMIN_CANNOT_BAN_SELF',
	USER_NOT_FOUND: 'ADMIN_USER_NOT_FOUND',
	YOU_ARE_NOT_ALLOWED_TO_BAN_USERS: 'ADMIN_ACTION_NOT_ALLOWED',
	YOU_ARE_NOT_ALLOWED_TO_REVOKE_USERS_SESSIONS: 'ADMIN_ACTION_NOT_ALLOWED'
};

function getProviderCode(error: unknown): string | undefined {
	if (!isAPIError(error)) return undefined;

	const code = (error.body as ApiErrorBody | undefined)?.code;
	return typeof code === 'string' ? code : undefined;
}

export function normalizeAdminAuthError(error: unknown): AdminAuthErrorCode | undefined {
	if (!isAPIError(error)) return undefined;

	const providerCode = getProviderCode(error);
	return providerCode
		? (PROVIDER_CODE_MAP[providerCode] ?? 'ADMIN_AUTH_ACTION_FAILED')
		: 'ADMIN_AUTH_ACTION_FAILED';
}

/**
 * Run one Better Auth admin operation at the Convex boundary.
 *
 * Provider failures are logged with their raw cause and exposed to clients only
 * as stable safe codes. Unexpected defects remain throwable and observable.
 */
export async function runAdminAuthApi(
	operation: AdminAuthOperation,
	call: () => Promise<unknown>
): Promise<void> {
	try {
		await call();
	} catch (error) {
		console.error(`[admin-auth:${operation}] Better Auth operation failed`, error);

		const code = normalizeAdminAuthError(error);
		if (!code) throw error;

		throw new ConvexError({ code });
	}
}
