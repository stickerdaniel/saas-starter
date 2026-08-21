type ErrorWithCode = { code?: string | null };

// Maps Better Auth error codes to i18n translation keys.
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
	// Raised by setPassword when the account already has a credential account,
	// e.g. a password set in another tab since this card was rendered.
	PASSWORD_ALREADY_SET: 'auth.messages.password_already_set',
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

	// Throttling. Raised by the app's own rate limiter, not by Better Auth, but it
	// reaches the same error path and every locale already carries the message.
	RATE_LIMITED: 'auth.messages.rate_limited',

	// Verdicts returned by api.users.setPassword rather than by Better Auth. They
	// reach the same error path, and each one needs to say what to do next: a
	// generic failure would leave the user retrying something that cannot work.
	// SESSION_NOT_FRESH is shared with passkey registration, which Better Auth
	// guards the same way, so its message names no particular credential.
	SESSION_NOT_FRESH: 'auth.messages.session_not_fresh',
	PASSWORD_TOO_WEAK: 'auth.messages.password_too_weak',
	CREDENTIAL_ACCOUNT_UNUSABLE: 'auth.messages.credential_account_unusable',
	IMPERSONATION_NOT_ALLOWED: 'auth.messages.impersonation_not_allowed',

	// Server errors
	FAILED_TO_CREATE_USER: 'auth.messages.signup_failed',
	FAILED_TO_CREATE_SESSION: 'auth.messages.generic_error',
	USER_NOT_FOUND: 'auth.messages.generic_error'
};

// Better Auth cannot hand an OAuth callback failure to the page that started it,
// because the browser is on the provider's site when the flow breaks. It
// redirects to the error URL and names the reason in an `error` query parameter
// instead, lowercased from its internal message. That is a separate namespace
// from the SDK `code` values above, so it needs its own map.
const OAUTH_CALLBACK_ERROR_MAP: Record<string, string> = {
	// The local account holding this address never verified it, so Better Auth
	// refuses to link the provider into it (GHSA-g38m-r43w-p2q7). This one earns
	// a message of its own: the user has to verify that address before the
	// provider will work, and a generic failure would send them round the same
	// loop forever.
	account_not_linked: 'auth.messages.account_not_linked'
};

export const DEFAULT_AUTH_ERROR_KEY = 'auth.messages.generic_error';

/**
 * Translate an OAuth callback `error` parameter into a message key.
 *
 * Returns `null` when there is no error to report. Any code without a specific
 * message falls back to the generic social-sign-in failure, so a rejected
 * callback can never land silently.
 */
export function getOAuthCallbackErrorKey(code: string | null | undefined): string | null {
	if (!code) {
		return null;
	}

	return OAUTH_CALLBACK_ERROR_MAP[code.toLowerCase()] ?? 'auth.messages.oauth_failed';
}

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
