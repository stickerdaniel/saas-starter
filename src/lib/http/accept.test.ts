import { describe, expect, it } from 'vitest';
import { MARKDOWN_ACCEPT_FIXTURES } from './accept.fixtures';
import { ACCEPTS_MARKDOWN_FUNCTION_SOURCE, acceptsMarkdownHeader } from './accept';

const acceptsMarkdownInWorker = Function(`return (${ACCEPTS_MARKDOWN_FUNCTION_SOURCE})`)() as (
	value: string | null
) => boolean;

describe('markdown Accept parsing', () => {
	it.each(MARKDOWN_ACCEPT_FIXTURES)(
		'parses $value as $expected on the server',
		({ value, expected }) => {
			expect(acceptsMarkdownHeader(value)).toBe(expected);
		}
	);

	it.each(MARKDOWN_ACCEPT_FIXTURES)(
		'parses $value as $expected in the worker',
		({ value, expected }) => {
			expect(acceptsMarkdownInWorker(value)).toBe(expected);
		}
	);
});
