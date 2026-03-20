import { describe, it, expect } from 'vitest';
import { getAuthErrorKey, DEFAULT_AUTH_ERROR_KEY } from '../auth-messages';

describe('getAuthErrorKey', () => {
	it('maps a known error code to the correct i18n key', () => {
		expect(getAuthErrorKey({ code: 'INVALID_CREDENTIALS' })).toBe(
			'auth.messages.invalid_credentials'
		);
	});

	it('maps USER_ALREADY_EXISTS to its i18n key', () => {
		expect(getAuthErrorKey({ code: 'USER_ALREADY_EXISTS' })).toBe(
			'auth.messages.user_already_exists'
		);
	});

	it('maps an OAuth error code to the oauth_failed i18n key', () => {
		expect(getAuthErrorKey({ code: 'STATE_MISMATCH' })).toBe('auth.messages.oauth_failed');
	});

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
