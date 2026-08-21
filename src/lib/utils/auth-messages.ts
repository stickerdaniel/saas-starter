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

	// Token. Both reach the user as a link they clicked: a verification link
	// through the destination it was minted with, a reset link through the reset
	// page. The message names the link rather than the token behind it.
	INVALID_TOKEN: 'auth.messages.invalid_token',
	TOKEN_EXPIRED: 'auth.messages.invalid_token',

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
	// Better Auth refuses to link a provider into an existing local account.
	// Four separate conditions collapse into this one string
	// (better-auth/dist/oauth2/link-account.mjs): an unverified local account,
	// which is the case GHSA-g38m-r43w-p2q7 is about; an untrusted provider
	// reporting an unverified address, where the local account may well be
	// verified; and either linking switch turned off. The copy therefore names
	// no cause and confirms no account, because the same string reaches someone
	// holding an unverified provider identity for an address they do not own.
	// It still earns a key of its own: the generic failure offers no way out and
	// sends the user round the same loop forever.
	account_not_linked: 'auth.messages.account_not_linked'
};

/**
 * The codes Better Auth appends when a verification link itself fails, rather
 * than the account behind it (`redirectOnError` in
 * better-auth/dist/api/routes/email-verification.mjs). Exported because the
 * destination splitter in $lib/utils/url needs the same list to tell a code
 * Better Auth wrote from an `error` parameter the app put in a continuation URL
 * itself.
 */
export const VERIFICATION_FAILURE_CODES = new Set([
	'TOKEN_EXPIRED',
	'INVALID_TOKEN',
	'USER_NOT_FOUND',
	'INVALID_USER'
]);

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

/**
 * Translate a verification-link failure into a message key.
 *
 * Returns `null` for anything else, including the lowercased OAuth callback
 * codes, so a caller reading a shared `error` parameter can fall through to
 * `getOAuthCallbackErrorKey`.
 *
 * All four codes reach the user the same way, as a link they clicked that did
 * not work, and the only move available for any of them is to request a new
 * one. Distinguishing them in the copy would tell an unauthenticated visitor
 * whether an account exists.
 */
export function getVerificationErrorKey(code: string | null | undefined): string | null {
	if (!code || !VERIFICATION_FAILURE_CODES.has(code)) {
		return null;
	}

	return 'auth.messages.invalid_token';
}
