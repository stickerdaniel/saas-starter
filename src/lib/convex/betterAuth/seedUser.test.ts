import { describe, expect, it } from 'vitest';
import { readSeedUser } from './seedUser';

describe('Better Auth seed user adapter', () => {
	it.each([undefined, null])('preserves absent user %j', (record) => {
		expect(readSeedUser(record)).toBeNull();
	});
	it('accepts only the fields required by seeding, including nullable plugin fields', () => {
		expect(
			readSeedUser({
				_id: 'u',
				email: 'a@example.test',
				role: null,
				emailVerified: null,
				password: 'not returned'
			})
		).toEqual({ _id: 'u', email: 'a@example.test', role: null, emailVerified: null });
		expect(
			readSeedUser({ _id: 'u', email: 'a@example.test', role: 'admin', emailVerified: true })
		).toEqual({ _id: 'u', email: 'a@example.test', role: 'admin', emailVerified: true });
	});
	it.each([
		{},
		[],
		'u',
		{ _id: 1, email: 'a' },
		{ _id: 'u', email: null },
		{ _id: 'u', email: 'a', role: 2 },
		{ _id: 'u', email: 'a', emailVerified: 'true' }
	])('rejects malformed component record %j rather than granting seed privileges', (record) => {
		expect(() => readSeedUser(record)).toThrow();
	});
});
