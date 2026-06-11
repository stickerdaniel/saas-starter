// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { decodeJwtPayload } from './jwt';

function makeToken(payload: unknown): string {
	const segment = Buffer.from(JSON.stringify(payload)).toString('base64url');
	return `header.${segment}.signature`;
}

describe('decodeJwtPayload', () => {
	it('decodes a valid token payload', () => {
		const payload = { sub: 'user_123', role: 'admin', email: 'admin@example.com' };
		expect(decodeJwtPayload(makeToken(payload))).toEqual(payload);
	});

	it('returns null for an undefined token', () => {
		expect(decodeJwtPayload(undefined)).toBeNull();
	});

	it('returns null for a garbage token', () => {
		expect(decodeJwtPayload('not-a-jwt')).toBeNull();
		expect(decodeJwtPayload('a.!!!!.c')).toBeNull();
	});

	it('returns null when the payload segment is missing', () => {
		expect(decodeJwtPayload('header-only')).toBeNull();
		expect(decodeJwtPayload('header.')).toBeNull();
	});

	it('returns null when the payload is not an object', () => {
		const segment = Buffer.from(JSON.stringify(null)).toString('base64url');
		expect(decodeJwtPayload(`header.${segment}.signature`)).toBeNull();
	});

	it('returns null when sub is missing', () => {
		expect(decodeJwtPayload(makeToken({ role: 'admin' }))).toBeNull();
	});
});
