import { describe, it, expect } from 'vitest';
import { getAuthErrorKey, DEFAULT_AUTH_ERROR_KEY } from '../auth-messages';

describe('getAuthErrorKey', () => {
	// Credential/auth codes
	describe('credential errors', () => {
		it('maps INVALID_EMAIL_OR_PASSWORD to invalid_credentials', () => {
			expect(getAuthErrorKey({ code: 'INVALID_EMAIL_OR_PASSWORD' })).toBe(
				'auth.messages.invalid_credentials'
			);
		});

		it('maps INVALID_EMAIL to invalid_credentials', () => {
			expect(getAuthErrorKey({ code: 'INVALID_EMAIL' })).toBe('auth.messages.invalid_credentials');
		});

		it('maps INVALID_PASSWORD to invalid_credentials', () => {
			expect(getAuthErrorKey({ code: 'INVALID_PASSWORD' })).toBe(
				'auth.messages.invalid_credentials'
			);
		});

		it('maps CREDENTIAL_ACCOUNT_NOT_FOUND to credential_account_not_found', () => {
			expect(getAuthErrorKey({ code: 'CREDENTIAL_ACCOUNT_NOT_FOUND' })).toBe(
				'auth.messages.credential_account_not_found'
			);
		});
	});

	// Account codes
	describe('account errors', () => {
		it('maps USER_ALREADY_EXISTS to user_already_exists', () => {
			expect(getAuthErrorKey({ code: 'USER_ALREADY_EXISTS' })).toBe(
				'auth.messages.user_already_exists'
			);
		});

		it('maps USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL to user_already_exists', () => {
			expect(getAuthErrorKey({ code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' })).toBe(
				'auth.messages.user_already_exists'
			);
		});

		it('maps EMAIL_NOT_VERIFIED to email_not_verified', () => {
			expect(getAuthErrorKey({ code: 'EMAIL_NOT_VERIFIED' })).toBe(
				'auth.messages.email_not_verified'
			);
		});
	});

	// Token codes
	describe('token errors', () => {
		it('maps INVALID_TOKEN to invalid_token', () => {
			expect(getAuthErrorKey({ code: 'INVALID_TOKEN' })).toBe('auth.messages.invalid_token');
		});
	});

	// Password validation codes
	describe('password validation errors', () => {
		it('maps PASSWORD_TOO_SHORT to password_too_short', () => {
			expect(getAuthErrorKey({ code: 'PASSWORD_TOO_SHORT' })).toBe(
				'auth.messages.password_too_short'
			);
		});

		it('maps PASSWORD_TOO_LONG to password_too_long', () => {
			expect(getAuthErrorKey({ code: 'PASSWORD_TOO_LONG' })).toBe(
				'auth.messages.password_too_long'
			);
		});
	});

	// OAuth/social codes
	describe('OAuth errors', () => {
		it('maps PROVIDER_NOT_FOUND to oauth_failed', () => {
			expect(getAuthErrorKey({ code: 'PROVIDER_NOT_FOUND' })).toBe('auth.messages.oauth_failed');
		});

		it('maps SOCIAL_ACCOUNT_ALREADY_LINKED to oauth_failed', () => {
			expect(getAuthErrorKey({ code: 'SOCIAL_ACCOUNT_ALREADY_LINKED' })).toBe(
				'auth.messages.oauth_failed'
			);
		});

		it('maps LINKED_ACCOUNT_ALREADY_EXISTS to oauth_failed', () => {
			expect(getAuthErrorKey({ code: 'LINKED_ACCOUNT_ALREADY_EXISTS' })).toBe(
				'auth.messages.oauth_failed'
			);
		});

		it('maps FAILED_TO_GET_USER_INFO to oauth_failed', () => {
			expect(getAuthErrorKey({ code: 'FAILED_TO_GET_USER_INFO' })).toBe(
				'auth.messages.oauth_failed'
			);
		});

		it('maps USER_EMAIL_NOT_FOUND to oauth_failed', () => {
			expect(getAuthErrorKey({ code: 'USER_EMAIL_NOT_FOUND' })).toBe('auth.messages.oauth_failed');
		});

		it('maps EMAIL_MISMATCH to oauth_failed', () => {
			expect(getAuthErrorKey({ code: 'EMAIL_MISMATCH' })).toBe('auth.messages.oauth_failed');
		});
	});

	// Passkey codes
	describe('passkey errors', () => {
		it('maps AUTH_CANCELLED to passkey_cancelled', () => {
			expect(getAuthErrorKey({ code: 'AUTH_CANCELLED' })).toBe('auth.messages.passkey_cancelled');
		});

		it('maps CHALLENGE_NOT_FOUND to passkey_failed', () => {
			expect(getAuthErrorKey({ code: 'CHALLENGE_NOT_FOUND' })).toBe('auth.messages.passkey_failed');
		});

		it('maps PASSKEY_NOT_FOUND to passkey_failed', () => {
			expect(getAuthErrorKey({ code: 'PASSKEY_NOT_FOUND' })).toBe('auth.messages.passkey_failed');
		});

		it('maps AUTHENTICATION_FAILED to passkey_failed', () => {
			expect(getAuthErrorKey({ code: 'AUTHENTICATION_FAILED' })).toBe(
				'auth.messages.passkey_failed'
			);
		});

		it('maps FAILED_TO_VERIFY_REGISTRATION to passkey_add_failed', () => {
			expect(getAuthErrorKey({ code: 'FAILED_TO_VERIFY_REGISTRATION' })).toBe(
				'auth.messages.passkey_add_failed'
			);
		});

		it('maps YOU_ARE_NOT_ALLOWED_TO_REGISTER_THIS_PASSKEY to passkey_add_failed', () => {
			expect(getAuthErrorKey({ code: 'YOU_ARE_NOT_ALLOWED_TO_REGISTER_THIS_PASSKEY' })).toBe(
				'auth.messages.passkey_add_failed'
			);
		});
	});

	// Server error codes
	describe('server errors', () => {
		it('maps FAILED_TO_CREATE_USER to signup_failed', () => {
			expect(getAuthErrorKey({ code: 'FAILED_TO_CREATE_USER' })).toBe(
				'auth.messages.signup_failed'
			);
		});

		it('maps FAILED_TO_CREATE_SESSION to generic_error', () => {
			expect(getAuthErrorKey({ code: 'FAILED_TO_CREATE_SESSION' })).toBe(
				'auth.messages.generic_error'
			);
		});

		it('maps USER_NOT_FOUND to generic_error', () => {
			expect(getAuthErrorKey({ code: 'USER_NOT_FOUND' })).toBe('auth.messages.generic_error');
		});
	});

	// Fallback behavior
	describe('fallback behavior', () => {
		it('returns the fallback key for an unknown error code', () => {
			expect(getAuthErrorKey({ code: 'TOTALLY_UNKNOWN_CODE' })).toBe(DEFAULT_AUTH_ERROR_KEY);
		});

		it('returns the fallback key when error is null', () => {
			expect(getAuthErrorKey(null)).toBe(DEFAULT_AUTH_ERROR_KEY);
		});

		it('returns the fallback key when error is undefined', () => {
			expect(getAuthErrorKey(undefined)).toBe(DEFAULT_AUTH_ERROR_KEY);
		});

		it('returns the fallback key when error object has no code property', () => {
			expect(getAuthErrorKey({ message: 'something went wrong' })).toBe(DEFAULT_AUTH_ERROR_KEY);
		});

		it('uses a custom fallback key when provided', () => {
			const custom = 'custom.fallback.key';
			expect(getAuthErrorKey(null, custom)).toBe(custom);
			expect(getAuthErrorKey({ code: 'TOTALLY_UNKNOWN_CODE' }, custom)).toBe(custom);
		});
	});

	// Regression: phantom codes from the old map must NOT be mapped
	describe('removed phantom codes return fallback', () => {
		const phantomCodes = [
			'INVALID_CREDENTIALS',
			'STATE_MISMATCH',
			'STATE_NOT_FOUND',
			'BAD_REQUEST',
			'UNKNOWN',
			'NO_CODE',
			'NO_CALLBACK_URL',
			'UNABLE_TO_LINK_ACCOUNT'
		];

		for (const code of phantomCodes) {
			it(`does not map former phantom code ${code}`, () => {
				expect(getAuthErrorKey({ code })).toBe(DEFAULT_AUTH_ERROR_KEY);
			});
		}
	});
});
