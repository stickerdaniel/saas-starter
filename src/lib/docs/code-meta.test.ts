import { describe, expect, it } from 'vitest';
import { parseCodeMeta } from './code-meta';

describe('parseCodeMeta', () => {
	it('reads the file name, line numbers and highlighted lines of an info string', () => {
		const meta = parseCodeMeta('title="svelte.config.js" {6,9-10} showLineNumbers', 12);
		expect(meta.title).toBe('svelte.config.js');
		expect(meta.lineNumbers).toBe(true);
		expect([...meta.highlighted]).toEqual([6, 9, 10]);
	});

	it('takes braces inside the title for part of the name', () => {
		const meta = parseCodeMeta('title="routes/{2}/+page.ts"', 3);
		expect(meta).toEqual({
			title: 'routes/{2}/+page.ts',
			lineNumbers: false,
			highlighted: new Set()
		});
	});

	it('numbers no lines for a title that names the directive', () => {
		expect(parseCodeMeta('title="showLineNumbers.ts"', 3).lineNumbers).toBe(false);
	});

	it('highlights only the lines a fence has, at once for a huge range', () => {
		expect([...parseCodeMeta('{1-1000000000}', 2).highlighted]).toEqual([1, 2]);
	});

	it('reads nothing from a fence without meta', () => {
		expect(parseCodeMeta(undefined, 1)).toEqual({
			title: null,
			lineNumbers: false,
			highlighted: new Set()
		});
	});
});
