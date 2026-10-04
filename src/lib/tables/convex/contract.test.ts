import { describe, expect, it } from 'vitest';
import { toCursorListResult } from './contract';

describe('toCursorListResult', () => {
	it('drops the cursor of a done page', () => {
		expect(
			toCursorListResult({ items: ['a'], continueCursor: 'adapter-end', isDone: true })
		).toEqual({ items: ['a'], continueCursor: null, isDone: true });
	});

	it('keeps the cursor of a pending page', () => {
		expect(toCursorListResult({ items: ['a'], continueCursor: 'next', isDone: false })).toEqual({
			items: ['a'],
			continueCursor: 'next',
			isDone: false
		});
	});

	it('ends a pending page that has no cursor', () => {
		expect(toCursorListResult({ items: ['a'], continueCursor: null, isDone: false })).toEqual({
			items: ['a'],
			continueCursor: null,
			isDone: true
		});
		expect(toCursorListResult({ items: [], continueCursor: '', isDone: false })).toEqual({
			items: [],
			continueCursor: null,
			isDone: true
		});
	});
});
