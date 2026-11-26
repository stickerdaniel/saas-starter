import { isAPIError } from 'better-auth/api';
import * as Effect from 'effect/Effect';
import { AdminRefusal } from '../errorCodecs';

export type AdminAuthErrorCode =
	| 'ADMIN_CANNOT_BAN_SELF'
	| 'ADMIN_USER_NOT_FOUND'
	| 'ADMIN_ACTION_NOT_ALLOWED'
	| 'ADMIN_AUTH_ACTION_FAILED';

export type AdminAuthOperation = 'ban_user' | 'unban_user' | 'revoke_user_sessions';

const PROVIDER_CODE_MAP: Record<string, AdminAuthErrorCode> = {
	YOU_CANNOT_BAN_YOURSELF: 'ADMIN_CANNOT_BAN_SELF',
	USER_NOT_FOUND: 'ADMIN_USER_NOT_FOUND',
	YOU_ARE_NOT_ALLOWED_TO_BAN_USERS: 'ADMIN_ACTION_NOT_ALLOWED',
	YOU_ARE_NOT_ALLOWED_TO_REVOKE_USERS_SESSIONS: 'ADMIN_ACTION_NOT_ALLOWED'
};

function getProviderCode(error: unknown): string | undefined {
	if (!isAPIError(error)) return undefined;

	const code: unknown = error.body?.code;
	return typeof code === 'string' ? code : undefined;
}

export function normalizeAdminAuthError(error: unknown): AdminAuthErrorCode | undefined {
	if (!isAPIError(error)) return undefined;

	const providerCode = getProviderCode(error);
	return providerCode
		? (PROVIDER_CODE_MAP[providerCode] ?? 'ADMIN_AUTH_ACTION_FAILED')
		: 'ADMIN_AUTH_ACTION_FAILED';
}

export const adminAuthApi = (operation: AdminAuthOperation, call: () => Promise<unknown>) =>
	Effect.tryPromise({ try: call, catch: (error) => error }).pipe(
		Effect.asVoid,
		Effect.catch((error) => {
			const code = normalizeAdminAuthError(error);
			return Effect.logError({
				code: 'admin_auth_failed',
				operation,
				reason: code ?? 'unexpected'
			}).pipe(Effect.andThen(code ? Effect.fail(new AdminRefusal({ code })) : Effect.die(error)));
		})
	);
