import { describe, expect, it } from 'vitest';
import { createLegalDocument, type LegalDocument, type LegalTemplate } from './legal-template';

function template(...names: string[]): LegalTemplate {
	return {
		nodes: [
			{
				type: 'list',
				ordered: false,
				start: 1,
				items: names.map((name) => [{ type: 'literal', name }])
			}
		]
	};
}

function literalTexts({ nodes, literals }: LegalDocument): string[] {
	const [list] = nodes;
	if (list?.type !== 'list') return [];
	return list.items
		.flat()
		.flatMap((node) => (node.type === 'literal' ? [literals[node.name]!] : []));
}

describe('createLegalDocument', () => {
	it('renders repeated and empty values as literal text', () => {
		const value = '*Northwind* {{OTHER}} <script>alert(1)</script> &amp;';
		const result = createLegalDocument('sample', template('NAME', 'NAME', 'EMPTY'), {
			NAME: value,
			EMPTY: ''
		});

		expect(literalTexts(result)).toEqual([value, value, '']);
		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result.literals)).toBe(true);
	});

	it('normalizes line endings without trimming whitespace', () => {
		const result = createLegalDocument('sample', template('VALUE'), {
			VALUE: '\r\n\t  first\rsecond\n\n    fourth'
		});

		expect(literalTexts(result)).toEqual(['\n\t  first\nsecond\n\n    fourth']);
	});

	it('rejects missing and unused values', () => {
		expect(() => createLegalDocument('sample', template('NAME'), {})).toThrow(
			'Missing placeholder value NAME for sample.'
		);
		expect(() => createLegalDocument('sample', template(), { NAME: 'value' })).toThrow(
			'Unused placeholder value NAME for sample.'
		);
	});

	it('rejects invalid names and non-string values', () => {
		expect(() =>
			createLegalDocument('sample', template('NAME'), { NAME: 42 } as unknown as Record<
				string,
				string
			>)
		).toThrow('Invalid legal literal NAME for sample.');
		expect(() => createLegalDocument('sample', template(), { 'invalid-name': 'value' })).toThrow(
			'Invalid placeholder value name invalid-name for sample.'
		);
	});

	it('uses only own enumerable values', () => {
		const inherited = Object.create({ NAME: 'inherited' }) as Record<string, string>;
		expect(() => createLegalDocument('sample', template('NAME'), inherited)).toThrow(
			'Missing placeholder value NAME for sample.'
		);
		expect(createLegalDocument('sample', template(), inherited).literals).toEqual({});

		const hidden = {} as Record<string, string>;
		Object.defineProperty(hidden, 'NAME', { enumerable: false, value: 'hidden' });
		expect(() => createLegalDocument('sample', template('NAME'), hidden)).toThrow(
			'Missing placeholder value NAME for sample.'
		);
	});

	it.each([
		['U+0000', 'before\0after'],
		['lone high surrogate', '\ud800'],
		['lone low surrogate', '\udc00']
	])('rejects %s', (_name, value) => {
		expect(() => createLegalDocument('sample', template('VALUE'), { VALUE: value })).toThrow(
			'Invalid legal literal VALUE for sample.'
		);
	});

	it('preserves well-formed astral Unicode', () => {
		const result = createLegalDocument('sample', template('VALUE'), { VALUE: 'Legal 🚀 𝄞' });
		expect(literalTexts(result)).toEqual(['Legal 🚀 𝄞']);
	});
});
