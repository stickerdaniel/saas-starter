import { describe, expect, it } from 'vitest';
import { cn } from './utils.js';

describe('cn', () => {
	it('lets a caller select-* replace selectable, and selectable replace select-none', () => {
		expect(cn('selectable text-sm', 'select-none').split(' ')).toEqual(['text-sm', 'select-none']);
		expect(cn('select-none', 'selectable')).toBe('selectable');
	});
});
