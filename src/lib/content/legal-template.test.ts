import { lex } from 'svelte-streamdown';
import { describe, expect, it } from 'vitest';
import { createLegalMarkdown, legalLiteralExtensions, resolveLegalLiteral } from './legal-template';

interface TestToken {
	readonly type: string;
	readonly raw: string;
	readonly name?: string;
	readonly tokens?: readonly unknown[];
}

function tokenRecords(values: unknown): TestToken[] {
	if (!Array.isArray(values)) return [];
	return values.flatMap((value) => {
		if (!value || typeof value !== 'object') return [];
		const record = value as Record<string, unknown>;
		if (typeof record.type !== 'string' || typeof record.raw !== 'string') return [];
		const token = record as unknown as TestToken;
		return [token, ...tokenRecords(token.tokens)];
	});
}

describe('createLegalMarkdown', () => {
	it('keeps repeated and adjacent values outside the Markdown source', () => {
		const value = '*Northwind* {{OTHER}}';
		const result = createLegalMarkdown('sample', '{{NAME}}{{NAME}} / {{EMPTY}}', {
			NAME: value,
			EMPTY: ''
		});

		expect(result.markdown).toBe('{{NAME}}{{NAME}} / {{EMPTY}}');
		expect(result.literals).toEqual({ NAME: value, EMPTY: '' });
		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result.literals)).toBe(true);

		const literalTokens = tokenRecords(
			lex(result.markdown, legalLiteralExtensions) as unknown
		).filter((token) => token.type === 'legalLiteral');
		expect(literalTokens.map((token) => token.name)).toEqual(['NAME', 'NAME', 'EMPTY']);
		expect(literalTokens.map((token) => Object.keys(token))).toEqual([
			['type', 'raw', 'name'],
			['type', 'raw', 'name'],
			['type', 'raw', 'name']
		]);
		expect(JSON.stringify(literalTokens)).not.toContain(value);
	});

	it('normalizes line endings without trimming whitespace', () => {
		const result = createLegalMarkdown('sample', 'Before\r\n{{VALUE}}\rAfter', {
			VALUE: '\r\n\t  first\rsecond\n\n    fourth'
		});

		expect(result.markdown).toBe('Before\n{{VALUE}}\nAfter');
		expect(result.literals.VALUE).toBe('\n\t  first\nsecond\n\n    fourth');
	});

	it('copies inputs before freezing the result', () => {
		const values = { NAME: 'Original' };
		const result = createLegalMarkdown('sample', '{{NAME}}', values);

		values.NAME = 'Changed';
		expect(result.literals.NAME).toBe('Original');
	});

	it('rejects missing and unused values', () => {
		expect(() => createLegalMarkdown('sample', '{{NAME}}', {})).toThrow(
			'Missing placeholder value NAME for sample.'
		);
		expect(() => createLegalMarkdown('sample', 'Authored', { NAME: 'value' })).toThrow(
			'Unused placeholder value NAME for sample.'
		);
	});

	it('rejects invalid names and non-string values', () => {
		expect(() => createLegalMarkdown('sample', '{{lowercase}}', {})).toThrow(
			'Invalid placeholder {{lowercase}} in sample.'
		);
		expect(() =>
			createLegalMarkdown('sample', '{{NAME}}', { NAME: 42 } as unknown as Record<string, string>)
		).toThrow('Invalid legal literal NAME for sample.');
		expect(() =>
			createLegalMarkdown('sample', 'Authored', {
				'invalid-name': 'value'
			} as unknown as Record<string, string>)
		).toThrow('Invalid placeholder value name invalid-name for sample.');
	});

	it('uses only own enumerable values', () => {
		const inherited = Object.create({ NAME: 'inherited' }) as Record<string, string>;
		expect(() => createLegalMarkdown('sample', '{{NAME}}', inherited)).toThrow(
			'Missing placeholder value NAME for sample.'
		);
		expect(createLegalMarkdown('sample', 'Authored', inherited).literals).toEqual({});

		const hidden = {} as Record<string, string>;
		Object.defineProperty(hidden, 'NAME', { enumerable: false, value: 'hidden' });
		expect(() => createLegalMarkdown('sample', '{{NAME}}', hidden)).toThrow(
			'Missing placeholder value NAME for sample.'
		);
	});

	it.each([
		['U+0000', 'before\0after'],
		['lone high surrogate', '\ud800'],
		['lone low surrogate', '\udc00']
	])('rejects %s', (_name, value) => {
		expect(() => createLegalMarkdown('sample', '{{VALUE}}', { VALUE: value })).toThrow(
			'Invalid legal literal VALUE for sample.'
		);
	});

	it('preserves well-formed astral Unicode', () => {
		const result = createLegalMarkdown('sample', '{{VALUE}}', { VALUE: 'Legal 🚀 𝄞' });
		expect(result.literals.VALUE).toBe('Legal 🚀 𝄞');
	});

	it.each([
		['image alt text', '![{{VALUE}}](image.png)'],
		['image destination', '![alt]({{VALUE}})'],
		['image title', '![alt](image.png "{{VALUE}}")'],
		['code fence', '```text\n{{VALUE}}\n```'],
		['inline code', '`{{VALUE}}`'],
		['link destination', '[label]({{VALUE}})'],
		['link title', '[label](privacy "{{VALUE}}")'],
		['HTML attribute', '<span title="{{VALUE}}">authored</span>'],
		['MDX attribute', '<Notice title="{{VALUE}}">authored</Notice>']
	])('rejects a marker in %s', (_name, template) => {
		expect(() => createLegalMarkdown('sample', template, { VALUE: 'literal' })).toThrow();
	});

	it('keeps authored Markdown active', () => {
		const result = createLegalMarkdown(
			'sample',
			'# Heading\n\n- Item with *emphasis* and [link](privacy)\n\n![authored alt](image.png)\n\n{{VALUE}}',
			{ VALUE: 'literal' }
		);
		const types = tokenRecords(lex(result.markdown, legalLiteralExtensions) as unknown).map(
			(token) => token.type
		);

		expect(types).toEqual(
			expect.arrayContaining(['heading', 'list', 'em', 'link', 'image', 'legalLiteral'])
		);
	});
});

describe('resolveLegalLiteral', () => {
	it('resolves own string values including empty strings', () => {
		expect(
			resolveLegalLiteral({ type: 'legalLiteral', raw: '{{VALUE}}', name: 'VALUE' }, { VALUE: '' })
		).toBe('');
		expect(
			resolveLegalLiteral(
				{ type: 'legalLiteral', raw: '{{VALUE}}', name: 'VALUE' },
				{ VALUE: '{{OTHER}}' }
			)
		).toBe('{{OTHER}}');
	});

	it.each([
		null,
		{},
		{ type: 'text', raw: '{{VALUE}}', name: 'VALUE' },
		{ type: 'legalLiteral', raw: '{{OTHER}}', name: 'VALUE' },
		{ type: 'legalLiteral', raw: '{{lowercase}}', name: 'lowercase' }
	])('rejects an invalid token %#', (token) => {
		expect(() => resolveLegalLiteral(token, { VALUE: 'literal' })).toThrow(
			'Invalid legal literal token.'
		);
	});

	it('rejects missing, inherited, and non-string entries', () => {
		const token = { type: 'legalLiteral', raw: '{{VALUE}}', name: 'VALUE' };
		expect(() => resolveLegalLiteral(token, {})).toThrow('Missing legal literal VALUE.');
		expect(() => resolveLegalLiteral(token, Object.create({ VALUE: 'inherited' }))).toThrow(
			'Missing legal literal VALUE.'
		);
		expect(() =>
			resolveLegalLiteral(token, { VALUE: 42 } as unknown as Record<string, string>)
		).toThrow('Invalid legal literal VALUE.');
	});
});
