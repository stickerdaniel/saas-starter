import { describe, expect, it } from 'vitest';
import { MARKDOWN_ACCEPT_FIXTURES } from './accept.fixtures';
import { prefersMarkdownHeader } from './accept';

describe('Markdown representation selection', () => {
	it.each(MARKDOWN_ACCEPT_FIXTURES)('selects $value as $expected', ({ value, expected }) => {
		expect(prefersMarkdownHeader(value)).toBe(expected);
	});
});
