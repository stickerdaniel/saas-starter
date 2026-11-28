import { afterEach, describe, expect, it } from 'vitest';
import { listKeys, readItem, removeItem, usable, writeItem } from './web-storage.ts';
import { blockStorage, storageFailures } from './testing/blocked-storage.ts';

let restore: (() => void) | undefined;

afterEach(() => {
	restore?.();
	restore = undefined;
	localStorage.clear();
	sessionStorage.clear();
});

describe('web storage', () => {
	it('reads a stored value, null for a missing key and undefined without storage', () => {
		expect(writeItem('local', 'present', 'value')).toBe(true);

		expect(readItem('local', 'present')).toBe('value');
		expect(readItem('local', 'absent')).toBeNull();

		restore = blockStorage('local', 'throwing getter');
		expect(readItem('local', 'present')).toBeUndefined();
	});

	it('keeps the two kinds apart', () => {
		writeItem('session', 'key', 'session value');

		expect(readItem('local', 'key')).toBeNull();
		expect(listKeys('session')).toEqual(['key']);
		expect(removeItem('session', 'key')).toBe(true);
		expect(readItem('session', 'key')).toBeNull();
	});

	it('counts working storage as usable and leaves no probe behind', () => {
		expect(usable('local')).toBe(true);
		expect(usable('session')).toBe(true);
		expect(localStorage.length).toBe(0);
		expect(sessionStorage.length).toBe(0);
	});

	it.each(storageFailures)('reports %s storage as unusable without throwing', (failure) => {
		restore = blockStorage('session', failure);

		expect(usable('session')).toBe(false);
		expect(writeItem('session', 'key', 'value')).toBe(false);
		expect(usable('local')).toBe(true);
	});
});
