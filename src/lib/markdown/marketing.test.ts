import { describe, expect, it, vi } from 'vitest';
import { lex } from 'svelte-streamdown';

const { maliciousAddress, maliciousBrandName, maliciousEmail, maliciousOperatorName } = vi.hoisted(
	() => ({
		maliciousAddress: 'Hauptstrasse 5\n\n## Forged section',
		maliciousBrandName: 'SaaS *Starter* [beta]\n## Forged brand',
		maliciousEmail: 'legal [at] example [dot] test',
		maliciousOperatorName: 'Operator #1'
	})
);

vi.mock('$lib/config/legal', () => ({
	LEGAL_CONFIG: {
		address: maliciousAddress,
		brandName: maliciousBrandName,
		companyName: 'Example Company',
		email: {
			domain: 'example',
			tld: 'test',
			user: 'legal'
		},
		operatorName: maliciousOperatorName
	},
	getLegalEmailAddress: () => 'legal@example.test',
	getObfuscatedLegalEmailAddress: () => maliciousEmail
}));

import {
	encodeMarkdownLiteral,
	markdownText,
	renderMarkdownText,
	renderPlainText
} from './literals';
import {
	createLlmsTxtResponse,
	createMarketingMarkdownResponse,
	createMarkdownNotAcceptableResponse,
	createPublicMarkdownNotFoundResponse,
	createRobotsTxtResponse,
	createSitemapXmlResponse,
	isMarkdownRequest,
	renderLlmsTxt,
	renderMarketingMarkdown,
	renderRobotsTxt,
	renderSitemapXml
} from './marketing';
import type { MarketingMarkdownDocument } from './types';
import { marketingMarkdown as homeMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/page.md';
import { marketingMarkdown as impressumMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/impressum/page.md';
import { LEGAL_CONFIG } from '$lib/config/legal';

const sampleDocument: MarketingMarkdownDocument = {
	title: 'Sample Page',
	description: 'A concise summary for agents.',
	sections: [
		{
			heading: 'Overview',
			paragraphs: ['One paragraph.'],
			bullets: ['First bullet', 'Second bullet']
		}
	]
};

const maliciousMarkdownLiteral = [
	'Literal text',
	'',
	'## Forged heading',
	'- Forged list',
	'> Forged quote',
	'```ts',
	'forgedCode()',
	'```',
	'    Forged indented code',
	'<div>Forged HTML</div>',
	'[Forged link](https://evil.example)'
].join('\r\n');

type LexToken = {
	type: string;
	depth?: number;
	raw?: string;
	text?: string;
	tokens?: LexToken[];
};

function collectTokens(tokens: LexToken[]): LexToken[] {
	return tokens.flatMap((token) => [token, ...(token.tokens ? collectTokens(token.tokens) : [])]);
}

function collectTokenTypes(tokens: LexToken[]): string[] {
	return collectTokens(tokens).map((token) => token.type);
}

function renderInlineText(token: LexToken): string {
	if (token.type === 'br') {
		return '\n';
	}
	if (token.tokens) {
		return token.tokens.map(renderInlineText).join('');
	}
	return (token.text ?? '').replaceAll('\u200b', '');
}

function getMarketingBody(markdown: string): string {
	const boundary = markdown.indexOf('---\n\n', 4);
	return markdown.slice(boundary + 5);
}

describe('markdown text literals', () => {
	it('keeps authored segments active and encodes only interpolations', () => {
		const rendered = renderMarkdownText(markdownText`**Authored** ${'*runtime*'} text`);
		const tokenTypes = collectTokenTypes(lex(rendered) as LexToken[]);

		expect(rendered).toBe('**Authored** \\*runtime\\* text');
		expect(tokenTypes.filter((type) => type === 'strong')).toHaveLength(1);
		expect(tokenTypes).not.toContain('em');
	});

	it('escapes the complete CommonMark ASCII punctuation set', () => {
		const punctuation = [
			'!',
			'"',
			'#',
			'$',
			'%',
			'&',
			"'",
			'(',
			')',
			'*',
			'+',
			',',
			'-',
			'.',
			'/',
			':',
			';',
			'<',
			'=',
			'>',
			'?',
			'@',
			'[',
			'\\',
			']',
			'^',
			'_',
			'`',
			'{',
			'|',
			'}',
			'~'
		];

		expect(encodeMarkdownLiteral(punctuation.join(''))).toBe(
			punctuation.map((character) => `\\${character}`).join('')
		);
	});

	it('normalizes line endings and keeps consecutive newlines as controlled breaks', () => {
		expect(encodeMarkdownLiteral('first\r\nsecond\rthird\nfourth')).toBe(
			'first<br>second<br>third<br>fourth'
		);
		expect(encodeMarkdownLiteral('\n')).toBe('\u200b<br>');
		expect(encodeMarkdownLiteral('\n\n')).toBe('<br><br>');
		expect(encodeMarkdownLiteral('\ntext')).toBe('<br>text');
		expect(encodeMarkdownLiteral('before\n\n## after')).toBe('before<br><br>\\#\\# after');
		const tokens = lex(encodeMarkdownLiteral('before\n\n## after')) as LexToken[];

		expect(collectTokenTypes(tokens)).not.toContain('heading');
		expect(collectTokens(tokens).filter((token) => token.type === 'br')).toEqual([
			expect.objectContaining({ raw: '<br>' }),
			expect.objectContaining({ raw: '<br>' })
		]);
	});

	it.each(['document description', 'paragraph'] as const)(
		'keeps a standalone break inline in a %s',
		(location) => {
			const standaloneBreak = markdownText`${'\n'}`;
			const document: MarketingMarkdownDocument =
				location === 'document description'
					? {
							title: 'Standalone break',
							description: standaloneBreak,
							sections: []
						}
					: {
							title: 'Standalone break',
							description: '',
							sections: [{ heading: 'Break', paragraphs: [standaloneBreak] }]
						};
			const markdown = renderMarketingMarkdown(document, {
				origin: 'https://example.com',
				pathname: '/en/test',
				lang: 'en'
			});
			const bodyTokens = lex(getMarketingBody(markdown)) as LexToken[];
			const paragraphs = bodyTokens.filter((token) => token.type === 'paragraph');
			const paragraphTokens = collectTokens(paragraphs);
			const tokenTypes = paragraphTokens.map((token) => token.type);

			expect(paragraphs).toHaveLength(1);
			expect(paragraphTokens.filter((token) => token.type === 'br')).toEqual([
				expect.objectContaining({ raw: '<br>' })
			]);
			expect(
				paragraphTokens.filter((token) => token.type === 'text' && token.text === '\u200b')
			).toHaveLength(1);
			for (const type of ['html', 'heading', 'link', 'code', 'blockquote']) {
				expect(tokenTypes).not.toContain(type);
			}
			expect(
				paragraphTokens.some((token) => token.type === 'text' && token.text?.includes('\\'))
			).toBe(false);
			expect(renderInlineText(paragraphs[0]!)).toBe('\n');
			expect(markdown).toContain('\u200b<br>');
			expect(renderPlainText(standaloneBreak)).toBe('\n');
			expect(renderPlainText(standaloneBreak)).not.toContain('\u200b');
		}
	);

	it.each([
		['one', 'Line 1\n', 1],
		['multiple', 'Line 1\n\n', 2]
	])('keeps %s terminal newline without visible markers', (_name, value, breakCount) => {
		const encoded = encodeMarkdownLiteral(value);
		const tokens = lex(encoded) as LexToken[];
		const allTokens = collectTokens(tokens);

		expect(tokens).toHaveLength(1);
		expect(tokens[0]?.type).toBe('paragraph');
		expect(renderInlineText(tokens[0]!)).toBe(value);
		expect(allTokens.filter((token) => token.type === 'br')).toHaveLength(breakCount);
		expect(allTokens.filter((token) => token.type === 'br').map((token) => token.raw)).toEqual(
			Array.from({ length: breakCount }, () => '<br>')
		);
		expect(allTokens.some((token) => token.type === 'text' && token.text?.includes('\\'))).toBe(
			false
		);
	});

	it('escapes authored break text before inserting controlled breaks', () => {
		const encoded = encodeMarkdownLiteral('User <br>\ncontrolled');
		const tokens = lex(encoded) as LexToken[];
		const allTokens = collectTokens(tokens);

		expect(encoded).toBe('User \\<br\\><br>controlled');
		expect(renderInlineText(tokens[0]!)).toBe('User <br>\ncontrolled');
		expect(allTokens.filter((token) => token.type === 'br')).toEqual([
			expect.objectContaining({ raw: '<br>' })
		]);
		expect(allTokens).not.toContainEqual(expect.objectContaining({ type: 'html' }));
	});

	it('keeps leading indentation out of code blocks', () => {
		for (const value of ['    indented code', '\tindented code']) {
			const encoded = encodeMarkdownLiteral(value);
			const tokenTypes = collectTokenTypes(lex(encoded) as LexToken[]);

			expect(tokenTypes).not.toContain('code');
			expect(tokenTypes).toContain('paragraph');
		}
	});

	it.each([
		['NUL', '\0', 'NUL characters'],
		['lone high surrogate', '\ud800', 'lone high UTF-16 surrogates'],
		['lone low surrogate', '\udc00', 'lone low UTF-16 surrogates']
	])('rejects %s', (_name, value, message) => {
		expect(() => encodeMarkdownLiteral(value)).toThrow(message);
		expect(() => renderPlainText(markdownText`${value}`)).toThrow(message);
	});

	it('renders plain text without markdown escapes', () => {
		expect(renderPlainText(markdownText`Authored *\r\n${'value_[x]\rline'}`)).toBe(
			'Authored *\nvalue_[x]\nline'
		);
		expect(renderPlainText('plain\r\ntext')).toBe('plain\ntext');
		expect(renderPlainText(markdownText`${'Valid 😀 pair'}`)).toBe('Valid 😀 pair');
	});

	it('rejects malformed direct markdownText calls', () => {
		const callMarkdownText = markdownText as unknown as (
			authoredSegments: unknown,
			...interpolations: unknown[]
		) => unknown;

		expect(() => callMarkdownText(['A'], 'B', 'C')).toThrow(
			'exactly one more item than interpolations'
		);
		expect(() => callMarkdownText(['A', 1, 'C'], 'B', 'D')).toThrow(
			'authoredSegments must be an array of strings'
		);
		expect(() => callMarkdownText(['A', 'C', 'E'], 'B', 1)).toThrow(
			'interpolations must be an array of strings'
		);
	});

	it('rejects unbranded and malformed branded values in both renderers', () => {
		const unbranded = {
			authoredSegments: Object.freeze(['A', 'C']),
			interpolations: Object.freeze(['B'])
		};
		const valid = markdownText`A${'B'}C`;
		const brand = Object.getOwnPropertySymbols(valid)[0]!;
		const malformedBranded = {
			[brand]: true,
			authoredSegments: Object.freeze(['A']),
			interpolations: Object.freeze(['B'])
		};

		for (const render of [renderMarkdownText, renderPlainText]) {
			expect(() => render(unbranded as never)).toThrow('created by markdownText');
			expect(() => render(malformedBranded as never)).toThrow(
				'exactly one more item than interpolations'
			);
		}
	});

	it('returns immutable markdownText values and lists', () => {
		const value = markdownText`A${'B'}C`;

		expect(Object.isFrozen(value)).toBe(true);
		expect(Object.isFrozen(value.authoredSegments)).toBe(true);
		expect(Object.isFrozen(value.interpolations)).toBe(true);
	});
});

describe('marketing markdown helpers', () => {
	it('detects markdown accept headers case-insensitively', () => {
		expect(
			isMarkdownRequest(
				new Request('https://example.com/en', {
					headers: {
						Accept: 'text/markdown, text/html;q=0.8'
					}
				})
			)
		).toBe(true);

		expect(
			isMarkdownRequest(
				new Request('https://example.com/en', {
					headers: {
						Accept: 'text/html, application/xhtml+xml'
					}
				})
			)
		).toBe(false);
	});

	it('renders frontmatter with requested route metadata', () => {
		const markdown = renderMarketingMarkdown(sampleDocument, {
			origin: 'https://example.com',
			pathname: '/de/pricing',
			lang: 'de'
		});

		expect(markdown).toContain('title: "Sample Page"');
		expect(markdown).toContain('route: "/de/pricing"');
		expect(markdown).toContain('lang_served: "de"');
		expect(markdown).toContain('content_language: "en"');
		expect(markdown).toContain('canonical: "https://example.com/de/pricing"');
		expect(markdown).toContain('## Overview');
		expect(markdown).toContain('- First bullet');
	});

	it('measures the forged heading produced by direct interpolation', () => {
		const markdown = renderMarketingMarkdown(
			{
				title: 'Legal notice',
				description: 'Provider details.',
				sections: [
					{
						heading: 'Contact',
						paragraphs: ['Address: Hauptstrasse 5\n\n## Forged section']
					}
				]
			},
			{ origin: 'https://example.com', pathname: '/en/impressum', lang: 'en' }
		);

		expect(
			lex(getMarketingBody(markdown)).some(
				(token) => token.type === 'heading' && token.text === 'Forged section'
			)
		).toBe(true);
	});

	it('keeps multiline literal titles inside their intended headings', () => {
		const value = 'Acme\n## forged';
		const literal = markdownText`${value}`;
		const markdown = renderMarketingMarkdown(
			{
				title: literal,
				description: 'Description',
				sections: [{ heading: literal }]
			},
			{ origin: 'https://example.com', pathname: '/en/test', lang: 'en' }
		);
		const tokens = lex(getMarketingBody(markdown)) as LexToken[];
		const headings = tokens.filter((token) => token.type === 'heading');

		expect(tokens.map((token) => token.type)).toEqual(['heading', 'paragraph', 'heading']);
		expect(headings.map((heading) => heading.depth)).toEqual([1, 2]);
		expect(headings.map(renderInlineText)).toEqual([value, value]);
		expect(
			headings
				.flatMap((heading) => collectTokens(heading.tokens ?? []))
				.filter((token) => token.type === 'br')
		).toHaveLength(2);
	});

	it('keeps multiline literals inside paragraph, bullet, and link contexts', () => {
		const paragraph = 'Paragraph\ninside\n\nend\n';
		const bullet = 'Bullet\r\ninside\r\rend\r';
		const label = 'Label\n\nend\n';
		const description = 'Description\ninside\n\n';
		const markdown = renderMarketingMarkdown(
			{
				title: 'Contexts',
				description: 'Description',
				sections: [
					{
						heading: 'Fields',
						paragraphs: [markdownText`${paragraph}`],
						bullets: [markdownText`${bullet}`],
						links: [
							{
								label: markdownText`${label}`,
								href: 'https://example.com/resource',
								description: markdownText`${description}`
							}
						]
					}
				]
			},
			{ origin: 'https://example.com', pathname: '/en/test', lang: 'en' }
		);
		const tokens = lex(getMarketingBody(markdown)) as LexToken[];
		const allTokens = collectTokens(tokens);
		const paragraphToken = tokens.find(
			(token) => token.type === 'paragraph' && renderInlineText(token).startsWith('Paragraph')
		);
		const listItems = allTokens.filter((token) => token.type === 'list_item');
		const link = allTokens.find((token) => token.type === 'link');

		expect(tokens.map((token) => token.type)).toEqual([
			'heading',
			'paragraph',
			'heading',
			'paragraph',
			'list'
		]);
		expect(renderInlineText(paragraphToken!)).toBe(paragraph);
		expect(renderInlineText(listItems[0]!)).toBe(bullet.replace(/\r\n?/g, '\n'));
		expect(renderInlineText(link!)).toBe(label);
		expect(renderInlineText(listItems[1]!)).toBe(`${label}: ${description}`);
		expect(allTokens.filter((token) => token.type === 'br')).toHaveLength(14);
		expect(collectTokenTypes(tokens)).not.toContain('code');
		expect(collectTokenTypes(tokens)).not.toContain('html');
		expect(collectTokenTypes(tokens)).not.toContain('blockquote');
	});

	it('keeps configured values literal in every rendered text field', () => {
		const literal = markdownText`${maliciousMarkdownLiteral}`;
		const markdown = renderMarketingMarkdown(
			{
				title: literal,
				description: literal,
				sections: [
					{
						heading: literal,
						paragraphs: [literal],
						bullets: [literal],
						links: [
							{
								label: literal,
								href: 'https://example.com/resource',
								description: literal
							}
						]
					}
				]
			},
			{ origin: 'https://example.com', pathname: '/en/test', lang: 'en' }
		);
		const tokens = lex(getMarketingBody(markdown)) as LexToken[];
		const tokenTypes = collectTokenTypes(tokens);

		expect(tokenTypes.filter((type) => type === 'heading')).toHaveLength(2);
		expect(tokenTypes.filter((type) => type === 'list')).toHaveLength(1);
		expect(tokenTypes.filter((type) => type === 'link')).toHaveLength(1);
		expect(
			collectTokens(tokens)
				.filter((token) => token.type === 'br')
				.every((token) => token.raw === '<br>')
		).toBe(true);
		expect(tokenTypes.filter((type) => type === 'br')).toHaveLength(70);
		expect(tokenTypes).not.toContain('code');
		expect(tokenTypes).not.toContain('html');
		expect(tokenTypes).not.toContain('blockquote');
		expect(markdown).toContain('(https://example.com/resource)');
		expect(JSON.stringify(tokens)).toContain('Forged heading');
		expect(JSON.stringify(tokens)).toContain('Forged indented code');
		expect(JSON.stringify(tokens)).toContain('Forged HTML');
	});

	it('keeps structured frontmatter plain and on one physical line per value', () => {
		const markdown = renderMarketingMarkdown(
			{
				title: markdownText`${'Brand *name*\r\nsecond line'}`,
				description: markdownText`Address: ${maliciousAddress}`,
				sections: []
			},
			{ origin: 'https://example.com', pathname: '/en/test', lang: 'en' }
		);
		const frontmatter = markdown.slice(0, markdown.indexOf('---\n\n', 4));

		expect(frontmatter).toContain('title: "Brand *name*\\nsecond line"');
		expect(frontmatter).toContain('description: "Address: Hauptstrasse 5\\n\\n## Forged section"');
		expect(frontmatter).not.toContain('\\*name\\*');
		expect(frontmatter.split('\n')).not.toContain('second line');
		expect(frontmatter.split('\n')).not.toContain('## Forged section');
	});

	it('keeps the configured legal address inside the Impressum paragraph', () => {
		const markdown = renderMarketingMarkdown(impressumMarketingMarkdown, {
			origin: 'https://example.com',
			pathname: '/en/impressum',
			lang: 'en'
		});
		const bodyTokens = lex(getMarketingBody(markdown));

		expect(markdown).toContain('Address: Hauptstrasse 5<br><br>\\#\\# Forged section');
		expect(
			bodyTokens.some((token) => token.type === 'heading' && token.text === 'Forged section')
		).toBe(false);
	});

	it('returns markdown responses with caching and vary headers', async () => {
		const response = createMarketingMarkdownResponse(homeMarketingMarkdown, {
			origin: 'https://example.com',
			pathname: '/de',
			lang: 'de'
		});

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
		expect(response.headers.get('vary')).toBe('Accept');
		// Markdown must stay out of shared caches: CF Edge (and most CDNs) ignore Vary,
		// so any edge-cacheable markdown would poison subsequent HTML requests on the same URL.
		expect(response.headers.get('cache-control')).toContain('private');
		expect(response.headers.get('cache-control')).not.toContain('s-maxage');

		const body = await response.text();
		expect(body).toContain('# Build & Ship Your Product Faster');
		expect(body).toContain(
			`${encodeMarkdownLiteral(LEGAL_CONFIG.brandName)} packages the core infrastructure`
		);
		expect(body).toContain('lang_served: "de"');
		expect(body).toContain('content_language: "en"');
	});

	it('returns a 406 response when markdown is not accepted', async () => {
		const response = createMarkdownNotAcceptableResponse();

		expect(response.status).toBe(406);
		expect(response.headers.get('vary')).toBe('Accept');
		expect(await response.text()).toBe('Not Acceptable');
	});

	it('renders llms discovery content with canonical marketing links', () => {
		const llms = renderLlmsTxt('https://example.com');
		const tokens = lex(llms) as LexToken[];
		const documentHeadings = tokens.filter(
			(token) => token.type === 'heading' && token.depth === 1
		);
		const heading = documentHeadings[0]!;

		expect(llms).toContain(`# ${encodeMarkdownLiteral(LEGAL_CONFIG.brandName)}`);
		expect(documentHeadings).toHaveLength(1);
		expect(renderInlineText(heading)).toBe(LEGAL_CONFIG.brandName);
		expect(collectTokens(heading.tokens ?? []).filter((token) => token.type === 'br')).toEqual([
			expect.objectContaining({ raw: '<br>' })
		]);
		expect(collectTokenTypes([heading])).not.toContain('em');
		expect(collectTokenTypes([heading])).not.toContain('link');
		expect(llms).toContain('https://example.com/en/privacy');
		expect(llms).toContain('https://example.com/en/terms');
		expect(llms).toContain('https://example.com/en/impressum');
		expect(llms).toContain('Accept: text/markdown');
		expect(llms).toContain('## When to use this site');
		expect(llms).toContain('## Developer resources');
		expect(llms).toContain('## Access limits');
		expect(llms).toContain('They do not provide delegated access for agents');
		expect(llms).toContain('no supported public integration API');
	});

	it('returns llms responses as plain text', () => {
		const response = createLlmsTxtResponse('https://example.com');

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
	});

	it('renders robots.txt with explicit disallow rules and sitemap reference', () => {
		const robots = renderRobotsTxt('https://example.com');

		expect(robots).toContain('User-agent: *');
		expect(robots).toContain('Allow: /');
		expect(robots).toContain('Disallow: /api/');
		// Private app/admin routes are kept out via per-page noindex, not robots.txt
		expect(robots).not.toContain('Disallow: /en/app');
		expect(robots).not.toContain('Disallow: /en/admin');
		expect(robots).toContain('Sitemap: https://example.com/sitemap.xml');
	});

	it('returns robots.txt responses as plain text', () => {
		const response = createRobotsTxtResponse('https://example.com');

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
		expect(response.headers.get('cache-control')).toContain('s-maxage=300');
	});

	it('renders sitemap.xml with all localized public marketing URLs', () => {
		const sitemap = renderSitemapXml('https://example.com');

		expect(sitemap).toContain('<?xml version="1.0" encoding="UTF-8"?>');
		expect(sitemap).toContain('<loc>https://example.com/en</loc>');
		expect(sitemap).toContain('<loc>https://example.com/fr/pricing</loc>');
		expect(sitemap).toContain('<loc>https://example.com/en/privacy</loc>');
		expect(sitemap).toContain('<loc>https://example.com/en/terms</loc>');
		expect(sitemap).toContain('<loc>https://example.com/en/impressum</loc>');
		expect(sitemap).not.toContain('/en/app');
		expect(sitemap).not.toContain('/en/admin');
	});

	it('declares the xhtml namespace for hreflang alternates', () => {
		const sitemap = renderSitemapXml('https://example.com');

		expect(sitemap).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
	});

	it('emits a full hreflang alternate group with x-default per route', () => {
		const sitemap = renderSitemapXml('https://example.com');

		// One alternate per supported language plus x-default, all pointing at the
		// pricing route variants.
		expect(sitemap).toContain(
			'<xhtml:link rel="alternate" hreflang="en" href="https://example.com/en/pricing"/>'
		);
		expect(sitemap).toContain(
			'<xhtml:link rel="alternate" hreflang="de" href="https://example.com/de/pricing"/>'
		);
		expect(sitemap).toContain(
			'<xhtml:link rel="alternate" hreflang="es" href="https://example.com/es/pricing"/>'
		);
		expect(sitemap).toContain(
			'<xhtml:link rel="alternate" hreflang="fr" href="https://example.com/fr/pricing"/>'
		);
		expect(sitemap).toContain(
			'<xhtml:link rel="alternate" hreflang="x-default" href="https://example.com/en/pricing"/>'
		);

		// x-default points at the home route's default-language URL too.
		expect(sitemap).toContain(
			'<xhtml:link rel="alternate" hreflang="x-default" href="https://example.com/en"/>'
		);
	});

	it('uses authored dates only for legal content', () => {
		const sitemap = renderSitemapXml('https://example.com');
		const entries = sitemap.match(/<url>[\s\S]*?<\/url>/g) ?? [];

		expect(entries).toHaveLength(20);
		expect(entries.filter((entry) => entry.includes('<lastmod>'))).toHaveLength(12);
		expect(
			entries.find((entry) => entry.includes('<loc>https://example.com/en</loc>'))
		).not.toContain('<lastmod>');
		expect(
			entries.find((entry) => entry.includes('<loc>https://example.com/en/pricing</loc>'))
		).not.toContain('<lastmod>');
		expect(
			entries.find((entry) => entry.includes('<loc>https://example.com/en/privacy</loc>'))
		).toContain('<lastmod>2026-03-18</lastmod>');
		expect(sitemap).not.toContain('1970-01-01');
	});

	it('turns a public 404 into markdown without losing response headers', async () => {
		const originalHeaders = new Headers({
			Vary: 'Origin',
			'Content-Type': 'text/html; charset=utf-8',
			'Content-Length': '100',
			ETag: 'old-body',
			'Content-Security-Policy': "frame-ancestors 'none'"
		});
		originalHeaders.append('Set-Cookie', 'first=1; Path=/; HttpOnly');
		originalHeaders.append('Set-Cookie', 'second=2; Path=/; Secure');
		const response = createPublicMarkdownNotFoundResponse(
			new Response('<html>missing</html>', { status: 404, headers: originalHeaders }),
			{ origin: 'https://example.com', lang: 'de' }
		);

		expect(response.status).toBe(404);
		expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('vary')).toBe('Origin, Accept');
		expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
		expect(response.headers.getSetCookie()).toEqual([
			'first=1; Path=/; HttpOnly',
			'second=2; Path=/; Secure'
		]);
		expect(response.headers.has('content-length')).toBe(false);
		expect(response.headers.has('etag')).toBe(false);
		expect(await response.text()).toContain('https://example.com/de');
		expect(
			await createPublicMarkdownNotFoundResponse(response, {
				origin: 'https://example.com',
				lang: 'de',
				head: true
			}).text()
		).toBe('');
	});

	it('returns sitemap responses as xml', () => {
		const response = createSitemapXmlResponse('https://example.com');

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/xml; charset=utf-8');
		expect(response.headers.get('cache-control')).toContain('s-maxage=300');
	});
});
