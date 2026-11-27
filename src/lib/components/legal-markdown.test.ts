// @vitest-environment node

import { createRequire } from 'node:module';
import { render } from 'svelte/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLegalDocument } from '#lib/content/legal-template.js';
import { parseLegalMarkdown } from '../../../scripts/legal-document';
import LegalMarkdown from './legal-markdown.svelte';

const page = vi.hoisted(() => ({
	params: { lang: 'en' },
	url: new URL('https://example.com/en/terms')
}));

vi.mock('$app/state', () => ({ page }));

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
	JSDOM: new (html?: string) => { window: { document: Document } };
};

function renderDocument(markdown: string, values: Readonly<Record<string, string>> = {}): Document {
	const content = createLegalDocument('sample', parseLegalMarkdown('terms', markdown), values);
	const { body } = render(LegalMarkdown, { props: { content } });
	return new JSDOM(body).window.document;
}

function links(document: Document) {
	return [...document.querySelectorAll('a')].map((link) => ({
		text: link.textContent,
		href: link.getAttribute('href'),
		title: link.getAttribute('title'),
		target: link.getAttribute('target'),
		rel: link.getAttribute('rel')
	}));
}

describe('LegalMarkdown', () => {
	afterEach(() => {
		page.params.lang = 'en';
	});

	it.each(['de', 'es', 'fr'])('renders relative links for the %s page', (lang) => {
		page.params.lang = lang;
		const markdown = [
			'[Inline](privacy "Read \\"the policy\\"") [Reference][policy] [Root](/privacy) [Home](/)',
			'[Anchor](#rights) [External](https://example.org/docs) [Script](javascript:alert(1))',
			String.raw`[Backslash](/\evil.example/privacy) [Protocol](//evil.example/privacy)`,
			'',
			'`[Inline code](privacy)`',
			'',
			'```md',
			'[Fenced code](privacy)',
			'```',
			'',
			'[policy]: terms'
		].join('\n');
		const document = renderDocument(markdown);
		const internal = { title: null, target: null, rel: null };

		expect(links(document)).toEqual([
			{ ...internal, text: 'Inline', href: `/${lang}/privacy`, title: 'Read "the policy"' },
			{ ...internal, text: 'Reference', href: `/${lang}/terms` },
			{ ...internal, text: 'Root', href: '/privacy' },
			{ ...internal, text: 'Home', href: '/' },
			{ ...internal, text: 'Anchor', href: '#rights' },
			{
				...internal,
				text: 'External',
				href: 'https://example.org/docs',
				target: '_blank',
				rel: 'noopener noreferrer'
			}
		]);
		for (const label of ['Backslash', 'Script', 'Protocol']) {
			expect(document.body.textContent).toContain(label);
		}
		expect(document.querySelector('[href^="javascript:" i], [src^="javascript:" i]')).toBeNull();
		expect(document.body.textContent).toContain('[Inline code](privacy)');
		expect(document.body.textContent).toContain('[Fenced code](privacy)');
	});

	it('renders markup in values, titles and code as text', () => {
		page.params.lang = 'de';
		const document = renderDocument(
			[
				'[Privacy](privacy "\\"><img src=x onerror=alert(1)>") {{VALUE}}',
				'',
				'`<script>alert(2)</script>` ![a"><script>alert(3)</script>](/logo.png)',
				'',
				'```html',
				'<img src=x onerror=alert(4)>',
				'```'
			].join('\n'),
			{ VALUE: '<script>alert(5)</script><a href="javascript:alert(6)">x</a>' }
		);

		expect(links(document)).toEqual([
			{
				text: 'Privacy',
				href: '/de/privacy',
				title: '"><img src=x onerror=alert(1)>',
				target: null,
				rel: null
			}
		]);
		expect(document.querySelector('.legal-literal')?.textContent).toBe(
			'<script>alert(5)</script><a href="javascript:alert(6)">x</a>'
		);
		expect([...document.querySelectorAll('code')].map((code) => code.textContent)).toEqual([
			'<script>alert(2)</script>',
			'<img src=x onerror=alert(4)>'
		]);
		expect(document.querySelector('img')?.getAttribute('alt')).toBe('a"><script>alert(3)</script>');
		expect(document.querySelector('script, [onerror]')).toBeNull();
	});

	it('renders configured values as exact literal text', () => {
		const operator = [
			'# Northwind GmbH',
			'> Quote',
			'- List Operator',
			'1. Numbered Operator',
			'```ts',
			'alert(1)',
			'```',
			'    indented operator'
		].join('\n');
		const brand = String.raw`*Star* **Bold** ~~Deleted~~ [Name](https://evil.example) ![Image](https://evil.example/image.png) <https://evil.example> <script>alert(1)</script> &amp; $x^2$ Anne\Marie`;
		const address = [
			'  Example Street 1',
			'\tSecond floor',
			'',
			'- Suite 2',
			'# Hidden heading',
			'<img src="https://evil.example/image.png">',
			'```html',
			'<script>alert(2)</script>',
			'```'
		].join('\r\n');
		const document = renderDocument(
			'# Authored heading\n\nAuthored *emphasis* and [Privacy](privacy).\n\nOperator:\n\n{{OPERATOR}}\n\nBrand: {{BRAND}}\n\nAddress:\n\n{{ADDRESS}}',
			{ OPERATOR: operator, BRAND: brand, ADDRESS: address }
		);
		const literals = [...document.querySelectorAll<HTMLElement>('.legal-literal')];

		expect(literals.map((element) => element.textContent)).toEqual([
			operator,
			brand,
			address.replace(/\r\n?/g, '\n')
		]);
		for (const literal of literals) {
			expect(literal.children).toHaveLength(0);
		}
		expect(document.querySelectorAll('h1')).toHaveLength(1);
		expect(document.querySelector('h1')?.textContent).toBe('Authored heading');
		expect(document.querySelectorAll('em')).toHaveLength(1);
		expect(document.querySelector('em')?.textContent).toBe('emphasis');
		expect(links(document).map((link) => link.href)).toEqual(['/en/privacy']);
		expect(
			document.querySelector('blockquote, ul, ol, pre, code, img, script, strong, del')
		).toBeNull();
	});

	it('renders table-cell values as literal text', () => {
		const value = '**Bold** <script>alert(1)</script> [Link](https://evil.example)';
		const document = renderDocument('| Header |\n| --- |\n| {{VALUE}} |', { VALUE: value });
		const literal = document.querySelector<HTMLElement>('td .legal-literal');

		expect(document.querySelector('th')?.textContent).toBe('Header');
		expect(document.querySelectorAll('table, thead, tbody')).toHaveLength(3);
		expect(literal?.textContent).toBe(value);
		expect(literal?.children).toHaveLength(0);
		expect(document.querySelector('strong, script, a')).toBeNull();
	});

	it('renders ordered list starts, cell alignment and image sources', () => {
		const document = renderDocument(
			[
				'3. Third',
				'4. Fourth',
				'',
				'| Left | Center | Right |',
				'| :--- | :---: | ---: |',
				'| a | b | c |',
				'',
				'![A & B &#169;](/logo.png)'
			].join('\n')
		);

		expect(document.querySelector('ol')?.getAttribute('start')).toBe('3');
		expect([...document.querySelectorAll('ol > li')].map((item) => item.textContent)).toEqual([
			'Third',
			'Fourth'
		]);
		expect(
			[...document.querySelectorAll('th, td')].map((cell) => cell.getAttribute('align'))
		).toEqual(['left', 'center', 'right', 'left', 'center', 'right']);
		expect(document.querySelector('img')?.getAttribute('src')).toBe('/logo.png');
		expect(document.querySelector('img')?.getAttribute('alt')).toBe('A & B ©');
	});
});
