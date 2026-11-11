import { describe, it, expect } from 'vitest';
import { isAnonymousUser, generateAnonymousUserId } from '../anonymousUser';

describe('isAnonymousUser', () => {
	it('returns true for valid anonymous user IDs', () => {
		expect(isAnonymousUser('anon_123e4567-e89b-12d3-a456-426614174000')).toBe(true);
		expect(isAnonymousUser('anon_abc')).toBe(true);
		expect(isAnonymousUser('anon_')).toBe(true);
	});

	it('returns false for authenticated user IDs', () => {
		// Convex IDs typically start with a different prefix
		expect(isAnonymousUser('jd72hf92jf82hf8h2f')).toBe(false);
		expect(isAnonymousUser('user_123')).toBe(false);
	});

	it('returns false for null/undefined', () => {
		expect(isAnonymousUser(null)).toBe(false);
		expect(isAnonymousUser(undefined)).toBe(false);
	});

	it('returns false for empty string', () => {
		expect(isAnonymousUser('')).toBe(false);
	});

	it('is case sensitive', () => {
		expect(isAnonymousUser('Anon_123')).toBe(false);
		expect(isAnonymousUser('ANON_123')).toBe(false);
	});
});

describe('generateAnonymousUserId', () => {
	it('generates IDs that pass isAnonymousUser check', () => {
		const id = generateAnonymousUserId();
		expect(isAnonymousUser(id)).toBe(true);
	});
});
