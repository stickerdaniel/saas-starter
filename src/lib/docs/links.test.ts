import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SITE_CONFIG } from '#lib/config/site.js';
import { docsCatalog } from './catalog';
import { docsMarkdown, docsPageView, publishDocs } from './engine';
import { resolveDocsHref, rewriteHrefs, type HrefContext, type LinkTargets } from './links';
import { repositoryDocs } from './source.server';
import type { DocsCatalog, DocsSource } from './types';
import { publishedCatalog } from './__fixtures__/catalogs';
import { fixtureDocs } from './__fixtures__/fixture-docs';

const targets: LinkTargets = {
	pages: new Map([
		['docs/README.md', ''],
		['docs/features/auth.md', 'features/auth']
	]),
	source: {
		root: 'docs/',
		markdown: Object.fromEntries(
			[
				'docs/README.md',
				'docs/features/README.md',
				'docs/features/auth.md',
				'docs/development.md',
				'docs/file name.md',
				'docs/section#A.md',
				'docs/what?.md'
			].map((file) => [file, ''])
		),
		assets: { 'docs/assets/light.gif': '/_app/immutable/assets/light.abc.gif' }
	},
	sourceRepository: 'acme/product'
};
const page = 'docs/features/README.md';
const html: HrefContext = { page, lang: 'de', format: 'html', origin: '' };
const markdown: HrefContext = { page, lang: 'de', format: 'markdown', origin: 'https://acme.dev' };

describe('resolveDocsHref', () => {
	it('sends a catalog page to its docs URL in the reader language', () => {
		expect(resolveDocsHref('auth.md#roles', targets, html)).toEqual({
			kind: 'page',
			href: '/de/docs/features/auth#roles'
		});
		expect(resolveDocsHref('../README.md', targets, markdown)).toEqual({
			kind: 'page',
			href: 'https://acme.dev/de/docs.md'
		});
	});

	it('sends an asset to its built URL and keeps the theme fragment', () => {
		expect(resolveDocsHref('../assets/light.gif#gh-light-mode-only', targets, markdown)).toEqual({
			kind: 'asset',
			href: 'https://acme.dev/_app/immutable/assets/light.abc.gif#gh-light-mode-only'
		});
	});

	it('sends any other repository path to GitHub on the source repository', () => {
		expect(resolveDocsHref('../../src/lib/confect/', targets, html)).toEqual({
			kind: 'source',
			path: 'src/lib/confect/',
			href: 'https://github.com/acme/product/tree/HEAD/src/lib/confect/'
		});
		expect(resolveDocsHref('../development.md', targets, html)).toEqual({
			kind: 'source',
			path: 'docs/development.md',
			href: 'https://github.com/acme/product/blob/HEAD/docs/development.md'
		});
		expect(resolveDocsHref('../', targets, html)).toEqual({
			kind: 'source',
			path: 'docs/',
			href: 'https://github.com/acme/product/tree/HEAD/docs/'
		});
	});

	it('leaves external links and fragments alone and refuses a path above the root', () => {
		expect(resolveDocsHref('https://svelte.dev', targets, html).kind).toBe('unchanged');
		expect(resolveDocsHref('#install', targets, html).kind).toBe('unchanged');
		expect(resolveDocsHref('../../../outside.md', targets, html).kind).toBe('unresolved');
	});

	it('gives a fragment of a published page its docs path in HTML and leaves it in Markdown', () => {
		const auth = { ...html, page: 'docs/features/auth.md' } as const;
		expect(resolveDocsHref('#install', targets, auth)).toEqual({
			kind: 'page',
			href: '/de/docs/features/auth#install'
		});
		expect(resolveDocsHref('#install', targets, { ...auth, format: 'markdown' })).toEqual({
			kind: 'unchanged',
			href: '#install'
		});
	});

	it('refuses a docs file, an asset or a docs directory the source does not hold', () => {
		for (const href of ['ghost.md', '../assets/dark.gif', '../setup/', 'ghost.md#part']) {
			expect(resolveDocsHref(href, targets, html), href).toEqual({ kind: 'unresolved' });
		}
	});

	it('encodes each segment of a source path, so an encoded name stays one file', () => {
		expect(resolveDocsHref('../file%20name.md', targets, html)).toMatchObject({
			path: 'docs/file name.md',
			href: 'https://github.com/acme/product/blob/HEAD/docs/file%20name.md'
		});
		expect(resolveDocsHref('../section%23A.md#intro', targets, html)).toMatchObject({
			path: 'docs/section#A.md',
			href: 'https://github.com/acme/product/blob/HEAD/docs/section%23A.md#intro'
		});
		expect(resolveDocsHref('../what%3F.md', targets, html)).toMatchObject({
			path: 'docs/what?.md',
			href: 'https://github.com/acme/product/blob/HEAD/docs/what%3F.md'
		});
	});

	it('keeps a query on a source link and refuses one on a page or an asset', () => {
		expect(resolveDocsHref('../../src/app.html?plain=1#L3', targets, html)).toMatchObject({
			kind: 'source',
			href: 'https://github.com/acme/product/blob/HEAD/src/app.html?plain=1#L3'
		});
		expect(resolveDocsHref('auth.md?tab=roles', targets, html).kind).toBe('unresolved');
		expect(resolveDocsHref('../assets/light.gif?v=2', targets, html).kind).toBe('unresolved');
	});
});

function markdownFiles(directory: string): string[] {
	return readdirSync(directory, { recursive: true, encoding: 'utf8' })
		.filter((file) => file.endsWith('.md'))
		.map((file) => `${directory}/${file.split('\\').join('/')}`);
}

describe('rewriteHrefs', () => {
	it('returns every Markdown file under docs/ and the fixtures byte for byte under an identity rewrite', () => {
		const files = [...markdownFiles('docs'), ...markdownFiles('src/lib/docs/__fixtures__/docs')];
		expect(files.length).toBeGreaterThan(30);
		for (const file of files) {
			const text = readFileSync(file, 'utf8');
			expect(
				rewriteHrefs(text, (href) => href),
				file
			).toBe(text);
		}
	});

	it('changes each destination the parser finds and nothing else', () => {
		const source = [
			'# Links',
			'',
			'[Valid](valid(1).md) and [Here](',
			'valid.md) and ![Shot](<shot one.gif> "A title") and `[Code](code.md)`.',
			'',
			'    [Indented](indented.md)',
			'',
			'> A [quote](quote.md',
			'> "split") ends.',
			'',
			"- An [item](item.md 'title')",
			'  - A [nested](nested.md)',
			'',
			'| Link |',
			'| ---- |',
			'| [cell](cell.md) |',
			'',
			'```md',
			'[Fenced](fenced.md)',
			'```',
			'',
			'Read [the reference][ref].',
			'',
			'[ref]:',
			'  <ref.md> "Reference"',
			''
		].join('\n');
		const seen: string[] = [];
		const result = rewriteHrefs(source, (href) => {
			seen.push(href);
			return `/to/${href.replace(/\W/g, '-')}`;
		});
		expect(seen).toEqual([
			'valid(1).md',
			'valid.md',
			'shot one.gif',
			'quote.md',
			'item.md',
			'nested.md',
			'cell.md',
			'ref.md'
		]);
		expect(result).toBe(
			source
				.replace('(valid(1).md)', '(/to/valid-1--md)')
				.replace('(\nvalid.md)', '(\n/to/valid-md)')
				.replace('<shot one.gif>', '</to/shot-one-gif>')
				.replace('(quote.md', '(/to/quote-md')
				.replace('(item.md', '(/to/item-md')
				.replace('(nested.md', '(/to/nested-md')
				.replace('(cell.md', '(/to/cell-md')
				.replace('<ref.md>', '</to/ref-md>')
		);
	});

	it('changes the destinations of an image inside a link and nothing else', () => {
		const source = 'See [![Shot](assets/shot.png "Shot")](valid.md#top) here.\n';
		expect(rewriteHrefs(source, (href) => `/to/${href.replace(/\W/g, '-')}`)).toBe(
			'See [![Shot](/to/assets-shot-png "Shot")](/to/valid-md-top) here.\n'
		);
	});
});

const site = SITE_CONFIG.githubSlug;

function publishedPage(guide: string) {
	const catalog: DocsCatalog = {
		site,
		sourceRepository: 'acme/product',
		pages: [
			{ source: 'docs/guide.md', slug: '', section: 'Guides' },
			{ source: 'docs/valid.md', slug: 'valid', section: 'Guides' },
			{ source: 'docs/valid(1).md', slug: 'valid-1', section: 'Guides' }
		]
	};
	const source: DocsSource = {
		root: 'docs/',
		markdown: {
			'docs/guide.md': guide,
			'docs/valid.md': '# Valid\n',
			'docs/valid(1).md': '# Valid one\n'
		},
		assets: { 'docs/assets/shot.png': '/_app/immutable/assets/shot.abc.png' }
	};
	const docs = publishDocs(catalog, source, site)!;
	const view = docsPageView(docs, '', 'en')!;
	return {
		body: `${view.lead}${view.body}`,
		headings: view.headings,
		twin: docsMarkdown(docs, '', 'en', 'https://acme.dev')!,
		sourceFiles: docs.sourceFiles
	};
}

function publishedGuide(...lines: string[]) {
	return publishedPage(['# Guide', '', ...lines, ''].join('\n'));
}

describe('published pages', () => {
	it('resolve a destination with balanced parentheses, in both representations', () => {
		const { body, twin } = publishedGuide('[Valid](valid(1).md)');
		expect(body).toBe('[Valid](/en/docs/valid-1)\n');
		expect(twin).toBe('# Guide\n\n[Valid](https://acme.dev/en/docs/valid-1.md)\n');
	});

	it('resolve a destination on the line after the link text, in both representations', () => {
		const { body, twin } = publishedGuide('[Here](', 'valid.md)');
		expect(body).toBe('[Here](\n/en/docs/valid)\n');
		expect(twin).toBe('# Guide\n\n[Here](\nhttps://acme.dev/en/docs/valid.md)\n');
	});

	it('leave a link in indented code as written, in both representations', () => {
		const { body, twin } = publishedGuide('Text.', '', '    [Example](valid.md)');
		expect(body).toBe('Text.\n\n    [Example](valid.md)\n');
		expect(twin).toBe('# Guide\n\nText.\n\n    [Example](valid.md)\n');
	});

	it('resolve an image inside a link, in both representations', () => {
		const { body, twin } = publishedGuide('[![Shot](assets/shot.png)](valid.md)');
		expect(body).toBe('[![Shot](/_app/immutable/assets/shot.abc.png)](/en/docs/valid)\n');
		expect(twin).toBe(
			'# Guide\n\n[![Shot](https://acme.dev/_app/immutable/assets/shot.abc.png)](https://acme.dev/en/docs/valid.md)\n'
		);
	});

	it.each([
		['in a block quote', ['> [Valid][ref]', '>', '> [ref]: valid.md']],
		['in a block quote inside a list item', ['- > [Valid][ref]', '  >', '  > [ref]: valid.md']],
		['in a nested block quote', ['> > [Valid][ref]', '> >', '> > [ref]: valid.md']],
		['in an alert', ['> [!NOTE]', '> [Valid][ref]', '>', '> [ref]: valid.md']],
		['with the label x', ['> [Valid][x]', '>', '> [x]: valid.md']],
		['with the label X', ['> [Valid][X]', '>', '> [X]: valid.md']],
		['for a reference outside the quote', ['[Valid][ref]', '', '> Quote', '>', '> [ref]: valid.md']]
	])('resolve a reference definition %s, on every call', (_, lines) => {
		const resolved = (href: string) => lines.join('\n').replace('valid.md', href);
		for (let call = 0; call < 3; call++) {
			const { body, twin } = publishedGuide(...lines);
			expect(body).toBe(`${resolved('/en/docs/valid')}\n`);
			expect(twin).toBe(`# Guide\n\n${resolved('https://acme.dev/en/docs/valid.md')}\n`);
		}
	});

	it('fail publication on a reference definition in a block quote that names no file, on every call', () => {
		for (let call = 0; call < 3; call++) {
			expect(() => publishedGuide('> [Ghost][ref]', '>', '> [ref]: ghost.md')).toThrow(
				'Docs page docs/guide.md: the link ghost.md names no repository file'
			);
		}
	});

	it.each(['valid.md', 'ghost.md'])(
		'fail publication on a definition of %s after a tab in a block quote, on every call',
		(target) => {
			const definition = `   [ref]: ${target}`;
			for (let call = 0; call < 3; call++) {
				expect(() => publishedGuide('>\t[Tab][ref]', '>\t', `>\t${definition}`)).toThrow(
					`Docs page docs/guide.md: the destination of ${JSON.stringify(definition)} cannot be placed in its source`
				);
			}
		}
	);

	it('resolve a destination with a backslash before a non-ASCII symbol, in both representations', () => {
		const { body, twin } = publishedGuide('[Arrow](valid.md#\\\u2192)');
		expect(body).toBe('[Arrow](/en/docs/valid#\u2192)\n');
		expect(twin).toBe('# Guide\n\n[Arrow](https://acme.dev/en/docs/valid.md#\u2192)\n');
	});

	it('resolve a reference in a block quote whose definition is outside it, on every call', () => {
		for (let call = 0; call < 2; call++) {
			const { body, twin } = publishedGuide('> [Valid][ref]', '', '[ref]: valid.md');
			expect(body).toBe('> [Valid][ref]\n\n[ref]: /en/docs/valid\n');
			expect(twin).toBe('# Guide\n\n> [Valid][ref]\n\n[ref]: https://acme.dev/en/docs/valid.md\n');
		}
	});

	it('resolve a shortcut reference, in both representations', () => {
		const { body, twin } = publishedGuide('[valid]', '', '[valid]: valid.md');
		expect(body).toBe('[valid]\n\n[valid]: /en/docs/valid\n');
		expect(twin).toBe('# Guide\n\n[valid]\n\n[valid]: https://acme.dev/en/docs/valid.md\n');
	});

	it.each([
		['in an alert', ['> [!NOTE]', '> Select [Production] in the menu, then [Open](valid.md).']],
		['in a table cell', ['| Role | Page |', '| --- | --- |', '| [Developer] | [Open](valid.md) |']],
		['in a heading', ['## Changes [2026]', '', '[Open](valid.md)']]
	])('keep text in brackets %s as written, in both representations', (_, lines) => {
		const { body, twin, headings } = publishedGuide(...lines);
		expect(headings.map(({ text }) => text)).toEqual(
			lines[0]!.startsWith('## ') ? [lines[0]!.slice(3)] : []
		);
		const resolved = (href: string) => lines.join('\n').replace('valid.md', href);
		expect(body).toBe(`${resolved('/en/docs/valid')}\n`);
		expect(twin).toBe(`# Guide\n\n${resolved('https://acme.dev/en/docs/valid.md')}\n`);
	});

	it.each([
		['a full reference', '[Valid][ref]', '[ref]: valid.md'],
		['a shortcut reference', '[valid]', '[valid]: valid.md']
	])(
		'fail publication on a definition inside a list item for %s, naming the cause',
		(_, reference, definition) => {
			expect(() => publishedGuide(`- ${reference}`, '', `  ${definition}`)).toThrow(
				`Docs page docs/guide.md: the html representation gives the destination valid.md as valid.md, not /en/docs/valid, because the lexer reports no definition for ${reference}: move a reference definition inside a list item out of the list`
			);
		}
	);

	it.each([
		['a footnote with a missing target', ['Text[^n].', '', '[^n]: [broken](ghost.md)']],
		['a footnote before an identical visible link', ['[^n]: [x](valid.md)', '', '[x](valid.md)']],
		['a footnote inside a list item', ['- Item', '', '  [^n]: [x](valid.md)']]
	])('fail publication on %s', (_, lines) => {
		expect(() => publishedGuide(...lines)).toThrow(
			'Docs page docs/guide.md: docs pages have no footnotes'
		);
	});

	it.each([
		['an ATX title', '# Guide\r\n\r\nRead [Valid](valid.md).\r\n'],
		['a Setext title', 'Guide\r\n=====\r\n\r\nRead [Valid](valid.md).\r\n']
	])('take %s with CRLF line endings out of the body and keep it in the twin', (_, guide) => {
		const { body, twin } = publishedPage(guide);
		const title = guide.split('\r\n\r\n')[0]!.replaceAll('\r\n', '\n');
		expect(body).toBe('Read [Valid](/en/docs/valid).\n');
		expect(twin).toBe(`${title}\n\nRead [Valid](https://acme.dev/en/docs/valid.md).\n`);
	});

	it('list the repository paths they link to as source files', () => {
		const { sourceFiles } = publishedGuide(
			'[Source](../src/app.html) and [Missing](../src/missing.ts).'
		);
		expect(sourceFiles).toEqual(['src/app.html', 'src/missing.ts']);
	});

	it('fail publication on a link to a docs file the source does not hold', () => {
		expect(() => publishedGuide('[Bad](ghost.md)')).toThrow(
			'the link ghost.md names no repository file'
		);
	});
});

describe.each([
	{ name: 'starter', catalog: docsCatalog, source: repositoryDocs },
	{ name: 'fixture', catalog: publishedCatalog, source: fixtureDocs }
])('the $name catalog', ({ catalog, source }) => {
	it('links only to source files that exist, a directory with a trailing slash and a file without', () => {
		const docs = publishDocs(catalog, source, catalog.site);
		for (const file of docs?.sourceFiles ?? []) {
			expect(existsSync(file), file).toBe(true);
			expect(statSync(file).isDirectory(), file).toBe(file.endsWith('/'));
		}
	});
});

describe('published fixture pages', () => {
	const docs = publishDocs(publishedCatalog, fixtureDocs, SITE_CONFIG.githubSlug)!;

	it('link to docs URLs and to the source files of the module', () => {
		expect(docs.sourceFiles).toEqual(['src/lib/docs/', 'src/lib/docs/catalog.ts']);
		expect(docsPageView(docs, '', 'en')!.body).toContain(
			'](/en/docs/reference/code#highlighted-lines)'
		);
		expect(docsMarkdown(docs, '', 'en', 'https://acme.dev')).toContain(
			'](https://acme.dev/en/docs/reference/code.md)'
		);
	});

	it('leave a link inside a code fence as written', () => {
		expect(docsMarkdown(docs, 'reference/code', 'en', 'https://acme.dev')).toContain(
			'// Markdown inside a fence stays literal: [the guide](../guide.md)'
		);
	});
});
