import { describe, expect, it } from 'vitest';
import type { LegalNode } from '../src/lib/content/legal-template';
import { parseLegalMarkdown } from './legal-document';

function parse(markdown: string): LegalNode[] {
	return [...parseLegalMarkdown('terms', markdown).nodes];
}

function flatten(nodes: readonly LegalNode[]): LegalNode[] {
	return nodes.flatMap((node) => {
		const children =
			node.type === 'list'
				? node.items.flat()
				: node.type === 'table'
					? [...node.head, ...node.rows.flat()].flatMap((cell) => cell.children)
					: 'children' in node
						? node.children
						: [];
		return [node, ...flatten(children)];
	});
}

function ofType<Type extends LegalNode['type']>(nodes: readonly LegalNode[], type: Type) {
	return flatten(nodes).filter((node): node is LegalNode & { type: Type } => node.type === type);
}

describe('parseLegalMarkdown', () => {
	it('keeps code, titles and alt text as text values', () => {
		const nodes = parse(
			[
				'`<script>alert(1)</script>`',
				'',
				'```html',
				'<img src=x onerror=alert(2)>',
				'```',
				'',
				'[Policy](privacy "\\"><img src=x onerror=alert(3)>") ![a"><script>alert(4)</script>](/logo.png)'
			].join('\n')
		);

		expect(ofType(nodes, 'codespan')).toEqual([
			{ type: 'codespan', value: '<script>alert(1)</script>' }
		]);
		expect(ofType(nodes, 'code')).toEqual([
			{ type: 'code', lang: 'html', value: '<img src=x onerror=alert(2)>' }
		]);
		expect(ofType(nodes, 'localLink')[0]?.title).toBe('"><img src=x onerror=alert(3)>');
		expect(ofType(nodes, 'image')).toEqual([
			{ type: 'image', src: '/logo.png', alt: 'a"><script>alert(4)</script>' }
		]);
	});

	it('nests inline formatting in link labels', () => {
		const [paragraph] = parse('[**Bold** and *emphasis*](https://example.org/docs)');

		expect(paragraph).toEqual({
			type: 'paragraph',
			children: [
				{
					type: 'link',
					href: 'https://example.org/docs',
					external: true,
					children: [
						{ type: 'strong', children: [{ type: 'text', value: 'Bold' }] },
						{ type: 'text', value: ' and ' },
						{ type: 'em', children: [{ type: 'text', value: 'emphasis' }] }
					]
				}
			]
		});
	});

	it('turns unsafe links into inert labels and drops unsafe images', () => {
		const nodes = parse(
			[
				'[Script](javascript:alert(1)) [Data](data:text/html,x) [Plain](http://example.org) [Empty]()',
				String.raw`[Backslash](/\evil.example/privacy) [Protocol](//evil.example/privacy)`,
				'[Dots](/docs/..//evil.example/privacy) [Tab](/%09/evil.example)',
				'![Pixel](javascript:alert(1)) ![Remote](//evil.example/pixel.png)'
			].join('\n')
		);

		expect(ofType(nodes, 'link').map((link) => link.href)).toEqual(['/%09/evil.example']);
		expect(ofType(nodes, 'localLink')).toEqual([]);
		expect(ofType(nodes, 'image')).toEqual([]);
		expect(
			ofType(nodes, 'blocked').flatMap((node) => ofType(node.children, 'text').map((t) => t.value))
		).toEqual(['Script', 'Data', 'Plain', 'Empty', 'Backslash', 'Protocol', 'Dots']);
		expect(ofType(nodes, 'text').map((text) => text.value)).toEqual(
			expect.arrayContaining(['Pixel', 'Remote'])
		);
	});

	it('leaves only links the current locale changes to render time', () => {
		const nodes = parse(
			'[A](privacy) [B][ref] [C](../impressum?x=1#y) [D](?print=1) [E](/privacy) [F](#rights) [G](mailto:a@example.org)\n\n[ref]: about'
		);

		expect(ofType(nodes, 'localLink').map((link) => link.path)).toEqual([
			'/privacy',
			'/about',
			'/impressum?x=1#y',
			'/terms?print=1'
		]);
		expect(ofType(nodes, 'link').map(({ href, external }) => ({ href, external }))).toEqual([
			{ href: '/privacy', external: false },
			{ href: '#rights', external: false },
			{ href: 'mailto:a@example.org', external: true }
		]);
	});

	it.each([
		['inline HTML', 'Authored <span>text</span>'],
		['an HTML block', '<div>\nAuthored\n</div>'],
		['an HTML comment', '<!-- note -->']
	])('rejects %s', (_name, markdown) => {
		expect(() => parseLegalMarkdown('sample', markdown)).toThrow(
			'Raw HTML is not allowed in sample.'
		);
	});

	it.each([
		['blockquote', '> Quote'],
		['checkbox', '- [ ] Task'],
		['del', '~~Deleted~~'],
		['escape', String.raw`\*literal\*`],
		['br', 'Line  \nbreak']
	])('rejects the %s token', (type, markdown) => {
		expect(() => parseLegalMarkdown('sample', markdown)).toThrow(
			`Unsupported Markdown ${type} in sample.`
		);
	});

	it('decodes character references and keeps other ampersands', () => {
		expect(ofType(parse('A & B &#169; &#38; &copy; &nbsp;x R&D; more'), 'text')).toEqual([
			{ type: 'text', value: 'A & B © & © \u00a0x R&D; more' }
		]);
	});

	it('flattens and decodes image alt text', () => {
		const nodes = parse(
			'![**A & B** &#169; &copy;](/logo.png) ![*Blocked* A & B &#169;](javascript:alert(1))'
		);

		expect(ofType(nodes, 'image')).toEqual([{ type: 'image', src: '/logo.png', alt: 'A & B © ©' }]);
		expect(ofType(nodes, 'text').map((text) => text.value)).toContain('Blocked A & B ©');
	});

	it('keeps placeholders in headings, lists, tables and link labels', () => {
		const { nodes } = parseLegalMarkdown(
			'sample',
			'# {{A}}\n\n- **{{B}}** [{{C}}](privacy)\n\n| {{D}} |\n| --- |\n| {{D}} |'
		);

		expect(ofType(nodes, 'literal').map((literal) => literal.name)).toEqual([
			'A',
			'B',
			'C',
			'D',
			'D'
		]);
	});

	it.each([
		['image alt text', '![{{VALUE}}](image.png)'],
		['image destination', '![alt]({{VALUE}})'],
		['image title', '![alt](image.png "{{VALUE}}")'],
		['code fence', '```text\n{{VALUE}}\n```'],
		['inline code', '`{{VALUE}}`'],
		['link destination', '[label]({{VALUE}})'],
		['link title', '[label](privacy "{{VALUE}}")'],
		['reference definition', '[label][ref]\n\n[ref]: privacy "{{VALUE}}"']
	])('rejects a placeholder in %s', (_name, markdown) => {
		expect(() => parseLegalMarkdown('sample', markdown)).toThrow(
			'Legal placeholders were not tokenized safely in sample.'
		);
	});

	it.each([
		['a lowercase name', '{{lowercase}}', 'Invalid placeholder {{lowercase}} in sample.'],
		['triple braces', '{{{VALUE}}}', 'Invalid placeholder syntax in sample.'],
		['a stray opening', 'Before {{ after', 'Invalid placeholder syntax in sample.']
	])('rejects %s', (_name, markdown, message) => {
		expect(() => parseLegalMarkdown('sample', markdown)).toThrow(message);
	});
});
