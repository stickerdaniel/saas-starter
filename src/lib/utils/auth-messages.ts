type ErrorWithCode = { code?: string | null };

// Maps Better Auth 1.4.17 error codes to i18n translation keys.
// Codes verified against @better-auth/core/src/error/codes.ts
const ERROR_CODE_MAP: Record<string, string> = {
	// Credential/auth
	INVALID_EMAIL_OR_PASSWORD: 'auth.messages.invalid_credentials',
	INVALID_EMAIL: 'auth.messages.invalid_credentials',
	INVALID_PASSWORD: 'auth.messages.invalid_credentials',
	CREDENTIAL_ACCOUNT_NOT_FOUND: 'auth.messages.credential_account_not_found',

	// Account
	USER_ALREADY_EXISTS: 'auth.messages.user_already_exists',
	USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'auth.messages.user_already_exists',
	EMAIL_NOT_VERIFIED: 'auth.messages.email_not_verified',

	// Token
	INVALID_TOKEN: 'auth.messages.invalid_token',

	// Password validation
	PASSWORD_TOO_SHORT: 'auth.messages.password_too_short',
	PASSWORD_TOO_LONG: 'auth.messages.password_too_long',

	// OAuth/social
	PROVIDER_NOT_FOUND: 'auth.messages.oauth_failed',
	SOCIAL_ACCOUNT_ALREADY_LINKED: 'auth.messages.oauth_failed',
	LINKED_ACCOUNT_ALREADY_EXISTS: 'auth.messages.oauth_failed',
	FAILED_TO_GET_USER_INFO: 'auth.messages.oauth_failed',
	USER_EMAIL_NOT_FOUND: 'auth.messages.oauth_failed',
	EMAIL_MISMATCH: 'auth.messages.oauth_failed',

	// Passkey (@better-auth/passkey plugin)
	AUTH_CANCELLED: 'auth.messages.passkey_cancelled',
	CHALLENGE_NOT_FOUND: 'auth.messages.passkey_failed',
	PASSKEY_NOT_FOUND: 'auth.messages.passkey_failed',
	AUTHENTICATION_FAILED: 'auth.messages.passkey_failed',
	FAILED_TO_VERIFY_REGISTRATION: 'auth.messages.passkey_add_failed',
	YOU_ARE_NOT_ALLOWED_TO_REGISTER_THIS_PASSKEY: 'auth.messages.passkey_add_failed',

	// Server errors
	FAILED_TO_CREATE_USER: 'auth.messages.signup_failed',
	FAILED_TO_CREATE_SESSION: 'auth.messages.generic_error',
	USER_NOT_FOUND: 'auth.messages.generic_error'
};

export const DEFAULT_AUTH_ERROR_KEY = 'auth.messages.generic_error';

export function getAuthErrorKey(
	error: unknown,
	fallbackKey: string = DEFAULT_AUTH_ERROR_KEY
): string {
	if (!error || typeof error !== 'object' || !('code' in error)) {
		return fallbackKey;
	}

	const code = (error as ErrorWithCode).code;

	if (code && ERROR_CODE_MAP[code]) {
		return ERROR_CODE_MAP[code];
	}

	return fallbackKey;
}
