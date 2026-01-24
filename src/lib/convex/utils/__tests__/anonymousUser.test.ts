import { describe, it, expect } from 'vitest';
import { isAnonymousUser, ANONYMOUS_USER_PREFIX, generateAnonymousUserId } from '../anonymousUser';

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

describe('ANONYMOUS_USER_PREFIX', () => {
	it('has the expected value', () => {
		expect(ANONYMOUS_USER_PREFIX).toBe('anon_');
	});
});

describe('generateAnonymousUserId', () => {
	it('generates an ID with the correct prefix', () => {
		const id = generateAnonymousUserId();
		expect(id.startsWith(ANONYMOUS_USER_PREFIX)).toBe(true);
	});

	it('generates unique IDs', () => {
		const id1 = generateAnonymousUserId();
		const id2 = generateAnonymousUserId();
		expect(id1).not.toBe(id2);
	});

	it('generates IDs that pass isAnonymousUser check', () => {
		const id = generateAnonymousUserId();
		expect(isAnonymousUser(id)).toBe(true);
	});

	it('generates IDs with UUID format after prefix', () => {
		const id = generateAnonymousUserId();
		const uuidPart = id.slice(ANONYMOUS_USER_PREFIX.length);
		// UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
		const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
		expect(uuidPart).toMatch(uuidRegex);
	});
});
