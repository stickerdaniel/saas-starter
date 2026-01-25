type ErrorWithCode = { code?: string | null };

const ERROR_CODE_MAP: Record<string, string> = {
	INVALID_CREDENTIALS: 'auth.messages.invalid_credentials',
	INVALID_EMAIL: 'auth.messages.invalid_credentials',
	INVALID_PASSWORD: 'auth.messages.invalid_credentials',
	USER_ALREADY_EXISTS: 'auth.messages.user_already_exists',
	EMAIL_NOT_VERIFIED: 'auth.messages.email_not_verified',
	INVALID_TOKEN: 'auth.messages.invalid_token',
	PASSWORD_COMPROMISED: 'auth.messages.password_compromised',
	TOO_MANY_ATTEMPTS: 'auth.messages.too_many_attempts',
	RATE_LIMITED: 'auth.messages.rate_limited',
	SIGNUP_DISABLED: 'auth.messages.signup_disabled',
	AUTH_CANCELLED: 'auth.messages.auth_cancelled',
	BAD_REQUEST: 'auth.messages.generic_error',
	UNKNOWN: 'auth.messages.generic_error',
	INVALID_CALLBACK_REQUEST: 'auth.messages.oauth_failed',
	STATE_NOT_FOUND: 'auth.messages.oauth_failed',
	STATE_MISMATCH: 'auth.messages.oauth_failed',
	ACCOUNT_ALREADY_LINKED_TO_DIFFERENT_USER: 'auth.messages.oauth_failed',
	"EMAIL_DOESN'T_MATCH": 'auth.messages.oauth_failed',
	EMAIL_NOT_FOUND: 'auth.messages.oauth_failed',
	NO_CALLBACK_URL: 'auth.messages.oauth_failed',
	NO_CODE: 'auth.messages.oauth_failed',
	OAUTH_PROVIDER_NOT_FOUND: 'auth.messages.oauth_failed',
	UNABLE_TO_LINK_ACCOUNT: 'auth.messages.oauth_failed',
	UNABLE_TO_GET_USER_INFO: 'auth.messages.oauth_failed'
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
