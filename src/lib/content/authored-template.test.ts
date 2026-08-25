import { describe, expect, it } from 'vitest';
import { renderAuthoredTemplate } from './authored-template';

describe('renderAuthoredTemplate', () => {
	it('renders repeated scalar and multiline placeholders with normalized line endings', () => {
		expect(
			renderAuthoredTemplate('sample', 'Hello {{NAME}}\r\n\r\n{{LINES}}\r\n{{NAME}}', {
				NAME: 'Ada',
				LINES: '- one\n- two'
			})
		).toBe('Hello Ada\n\n- one\n- two\nAda');
	});

	it('rejects missing placeholder values', () => {
		expect(() => renderAuthoredTemplate('sample', '{{NAME}}', {})).toThrow(
			'Missing placeholder value NAME for sample.'
		);
	});

	it('rejects unused placeholder values', () => {
		expect(() => renderAuthoredTemplate('sample', 'Hello', { NAME: 'Ada' })).toThrow(
			'Unused placeholder value NAME for sample.'
		);
	});

	it('rejects invalid placeholder names', () => {
		expect(() => renderAuthoredTemplate('sample', '{{brandName}}', {})).toThrow(
			'Invalid placeholder {{brandName}} in sample.'
		);
	});

	it('rejects malformed placeholder syntax', () => {
		expect(() => renderAuthoredTemplate('sample', '{{NAME', {})).toThrow(
			'Invalid placeholder syntax in sample.'
		);
	});

	it('rejects placeholders introduced by replacement values', () => {
		expect(() => renderAuthoredTemplate('sample', '{{NAME}}', { NAME: '{{UNRESOLVED}}' })).toThrow(
			'Unresolved placeholder {{UNRESOLVED}} in sample.'
		);
	});
});
