import { describe, expect, it } from 'vitest';
import { userInitials } from './user-initials';

describe('userInitials', () => {
	it.each([
		['two words', 'John Smith', undefined, 'JS'],
		['three words take the first and last', 'Grace Brewster Hopper', undefined, 'GH'],
		['a single word gives one letter', 'Zoe', undefined, 'Z'],
		['extra whitespace', '  ada   lovelace ', undefined, 'AL'],
		['a name wins over the email', 'Bo Li', 'someone@example.com', 'BL'],
		['no name falls back to the email local part', undefined, 'jane.doe@example.com', 'J'],
		['an empty name falls back to the email', '   ', 'max@example.com', 'M'],
		['nothing', undefined, undefined, '?'],
		['an email without a local part', null, '@example.com', '?']
	])('%s', (_case, name, email, expected) => {
		expect(userInitials(name, email)).toBe(expected);
	});

	it('keeps only the first letter with max 1', () => {
		expect(userInitials('John Smith', undefined, 1)).toBe('J');
	});
});
