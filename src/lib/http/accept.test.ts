import { describe, expect, it } from 'vitest';
import { MARKDOWN_ACCEPT_FIXTURES } from './accept.fixtures';
import { PREFERS_MARKDOWN_FUNCTION_SOURCE, prefersMarkdownHeader } from './accept';

const prefersMarkdownInWorker = Function(`return (${PREFERS_MARKDOWN_FUNCTION_SOURCE})`)() as (
	value: string | null
) => boolean;

describe('Markdown representation selection', () => {
	it.each(MARKDOWN_ACCEPT_FIXTURES)(
		'selects $value as $expected on the server',
		({ value, expected }) => {
			expect(prefersMarkdownHeader(value)).toBe(expected);
		}
	);

	it.each(MARKDOWN_ACCEPT_FIXTURES)(
		'selects $value as $expected in the worker',
		({ value, expected }) => {
			expect(prefersMarkdownInWorker(value)).toBe(expected);
		}
	);
});
