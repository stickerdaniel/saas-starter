// @vitest-environment node

import { createRequire } from 'node:module';
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import { createLegalMarkdown, type LegalMarkdownContent } from '$lib/content/legal-template';
import LegalMarkdown from './legal-markdown.svelte';

vi.mock('$app/state', () => ({
	page: {
		params: { lang: 'en' },
		url: new URL('https://example.com/en/terms')
	}
}));

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
	JSDOM: new (html?: string) => { window: { document: Document } };
};

function renderDocument(content: LegalMarkdownContent): Document {
	const { body } = render(LegalMarkdown, { props: { content } });
	return new JSDOM(body).window.document;
}

describe('LegalMarkdown', () => {
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
		const content = createLegalMarkdown(
			'sample',
			'# Authored heading\n\nAuthored *emphasis* and [Privacy](privacy).\n\nOperator:\n\n{{OPERATOR}}\n\nBrand: {{BRAND}}\n\nAddress:\n\n{{ADDRESS}}',
			{ OPERATOR: operator, BRAND: brand, ADDRESS: address }
		);
		const document = renderDocument(content);
		const literals = [...document.querySelectorAll<HTMLElement>('.legal-literal')];

		expect(literals.map((element) => element.textContent)).toEqual([
			operator,
			brand,
			address.replace(/\r\n?/g, '\n')
		]);
		for (const literal of literals) {
			expect(literal.style.whiteSpace).toBe('pre-wrap');
			expect(literal.children).toHaveLength(0);
		}

		expect(document.querySelectorAll('h1')).toHaveLength(1);
		expect(document.querySelector('h1')?.textContent).toBe('Authored heading');
		expect(document.querySelectorAll('em')).toHaveLength(1);
		expect(document.querySelector('em')?.textContent).toBe('emphasis');
		expect(document.querySelectorAll('a')).toHaveLength(1);
		expect(document.querySelector('a')?.getAttribute('href')).toBe('/en/privacy');
		expect(document.querySelector('a')?.hasAttribute('data-streamdown-link')).toBe(true);
		expect(
			document.querySelector(
				'blockquote, ul, ol, pre, code, img, script, strong, del, [data-streamdown-math]'
			)
		).toBeNull();
	});

	it('renders table-cell values as literal text', () => {
		const value = '**Bold** <script>alert(1)</script> [Link](https://evil.example)';
		const document = renderDocument(
			createLegalMarkdown('sample', '| Header |\n| --- |\n| {{VALUE}} |', { VALUE: value })
		);
		const literal = document.querySelector<HTMLElement>('td .legal-literal');

		expect(document.querySelector('th')?.textContent).toBe('Header');
		expect(document.querySelectorAll('table, thead, tbody')).toHaveLength(3);
		expect(literal?.textContent).toBe(value);
		expect(literal?.children).toHaveLength(0);
		expect(document.querySelector('strong, script, a')).toBeNull();
	});

	it('keeps same-named literals isolated between documents', () => {
		const first = renderDocument(createLegalMarkdown('first', '{{NAME}}', { NAME: 'First value' }));
		const second = renderDocument(
			createLegalMarkdown('second', '{{NAME}}', { NAME: 'Second value' })
		);

		expect(first.querySelector('.legal-literal')?.textContent).toBe('First value');
		expect(second.querySelector('.legal-literal')?.textContent).toBe('Second value');
	});
});
