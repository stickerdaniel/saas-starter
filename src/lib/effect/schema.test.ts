import { describe, expect, it } from 'vitest';
import { isEmailAddress } from './schema';

describe('isEmailAddress', () => {
	it.each(['a@b.co', 'first.last+tag@sub.example.com', 'a_b@c-d.com'])('accepts %s', (email) => {
		expect(isEmailAddress(email)).toBe(true);
	});

	it.each(['a@b', 'a@b.c', 'a..b@c.com', 'ä@b.com', 'a@ä.com', ' a@b.co', '', 42, null])(
		'refuses %j',
		(email) => {
			expect(isEmailAddress(email)).toBe(false);
		}
	);
});
