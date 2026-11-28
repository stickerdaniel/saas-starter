import { describe, expect, it } from 'vitest';
import { SITE_CONFIG } from '#lib/config/site.js';
import { docsPageView, docsSearchIndex, publishDocs } from './engine';
import type { DocsHeading } from './headings';
import { emptyCatalog, foreignSiteCatalog, publishedCatalog } from './__fixtures__/catalogs';
import { fixtureDocs } from './__fixtures__/fixture-docs';

describe('publishDocs', () => {
	it('publishes a catalog only with pages and the deployment slug as its site', () => {
		expect(publishDocs(publishedCatalog, fixtureDocs, SITE_CONFIG.githubSlug)).not.toBeNull();
		expect(publishDocs(foreignSiteCatalog, fixtureDocs, SITE_CONFIG.githubSlug)).toBeNull();
		expect(publishDocs(emptyCatalog, fixtureDocs, SITE_CONFIG.githubSlug)).toBeNull();
		expect(publishDocs(foreignSiteCatalog, fixtureDocs, foreignSiteCatalog.site)).not.toBeNull();
	});

	it('takes the H1 out of the body and refuses a page with a second H1', () => {
		const docs = publishDocs(publishedCatalog, fixtureDocs, SITE_CONFIG.githubSlug)!;
		const entry = docsPageView(docs, '', 'en')!;
		expect(entry.title).toBe('Fixture guide');
		expect(entry.body).not.toMatch(/^# /m);

		const [first] = publishedCatalog.pages;
		const twice = {
			...fixtureDocs,
			markdown: { ...fixtureDocs.markdown, [first!.source]: '# One\n\nText.\n\n# Two\n' }
		};
		expect(() => publishDocs(publishedCatalog, twice, SITE_CONFIG.githubSlug)).toThrow(
			'exactly one H1'
		);
	});

	it('gives headings GitHub anchors, suffixed for duplicates and without inline syntax', () => {
		const docs = publishDocs(publishedCatalog, fixtureDocs, SITE_CONFIG.githubSlug)!;
		const ids = (headings: readonly DocsHeading[]): string[] =>
			headings.flatMap((heading) => [heading.id, ...ids(heading.children)]);
		expect(ids(docsPageView(docs, '', 'en')!.headings)).toEqual([
			'install-the-fixture',
			'requirements',
			'example',
			'configure-the-fixture',
			'example-1',
			'an-emphasis-and-code-heading',
			'headings-in-blocks',
			'a-heading-in-a-quote',
			'a-heading-after-a-paragraph',
			'a-heading-in-a-list-item',
			'a-fifth-level-heading',
			'blocks-in-blocks',
			'a-second-level-in-a-quote',
			'a-third-level-in-a-quote',
			'a-fifth-level-in-a-quote',
			'a-sixth-level-in-a-quote',
			'a-heading-after-a-rule',
			'a-heading-with-a-link',
			'alerts',
			'deploy-the-fixture',
			'cloudflare',
			'vercel',
			'node',
			'links-outside-the-docs'
		]);
	});

	it('names a heading that shows an image alone by the alt text, in its anchor and in search', () => {
		const [first] = publishedCatalog.pages;
		const withPage = (body: string) => ({
			...fixtureDocs,
			markdown: { ...fixtureDocs.markdown, [first!.source]: `# Guide\n\n${body}\n` }
		});
		const docs = publishDocs(
			publishedCatalog,
			withPage('## ![Deploy button](https://example.com/deploy.svg)\n\nText below the image.'),
			SITE_CONFIG.githubSlug
		)!;
		expect(docsPageView(docs, '', 'en')!.headings).toEqual([
			{ id: 'deploy-button', text: 'Deploy button', depth: 2, children: [] }
		]);
		expect(
			docsSearchIndex(docs)
				.find((page) => page.slug === first!.slug)!
				.sections.at(-1)
		).toEqual({ id: 'deploy-button', heading: 'Deploy button', text: 'Text below the image.' });
	});

	it.each([
		['an image without alt text', '## ![](https://example.com/deploy.svg)'],
		['punctuation alone', '## ...'],
		['an emoji alone', '## \u{1F389}']
	])('refuses a heading without an anchor: %s', (_, heading) => {
		const [first] = publishedCatalog.pages;
		const page = {
			...fixtureDocs,
			markdown: { ...fixtureDocs.markdown, [first!.source]: `# Guide\n\n${heading}\n\nText.\n` }
		};
		expect(() => publishDocs(publishedCatalog, page, SITE_CONFIG.githubSlug)).toThrow(
			'a letter or a digit for its anchor'
		);
	});
});

describe('docsPageView', () => {
	const docs = publishDocs(publishedCatalog, fixtureDocs, SITE_CONFIG.githubSlug)!;

	it('gives the paragraph below the H1 to the page header and the rest to the body', () => {
		const view = docsPageView(docs, 'reference/code', 'en')!;
		expect(view.lead.trim()).toBe(
			'The second fixture page holds a code fence with a file name and a highlighted line.'
		);
		expect(view.body).not.toContain('The second fixture page');
		expect(view.body.trimStart()).toMatch(/^## Highlighted lines/);
	});

	it('keeps an opening paragraph whose reference is defined further down in the body', () => {
		const [first] = publishedCatalog.pages;
		const reference = {
			...fixtureDocs,
			markdown: {
				...fixtureDocs.markdown,
				[first!.source]: '# Guide\n\nRead [the code page][code].\n\n[code]: reference/code.md\n'
			}
		};
		const view = docsPageView(
			publishDocs(publishedCatalog, reference, SITE_CONFIG.githubSlug)!,
			'',
			'en'
		)!;
		expect(view.lead).toBe('');
		expect(view.body).toContain('[the code page][code]');
	});

	it.each([
		['a blank line', '# Guide\n\n\nOpening paragraph here.\n\n## Next\n\nMore.\n'],
		['a line of spaces', '# Guide\n   \nOpening paragraph here.\n\n## Next\n\nMore.\n'],
		['CRLF line ends', '# Guide\r\n\r\nOpening paragraph here.\r\n\r\n## Next\r\n\r\nMore.\r\n'],
		['a tab line and CRLF', '# Guide\r\n\t\r\nOpening paragraph here.\r\n\r\n## Next\r\n']
	])('shows the opening paragraph once after %s below the H1', (_, markdown) => {
		const [first] = publishedCatalog.pages;
		const source = {
			...fixtureDocs,
			markdown: { ...fixtureDocs.markdown, [first!.source]: markdown }
		};
		const view = docsPageView(
			publishDocs(publishedCatalog, source, SITE_CONFIG.githubSlug)!,
			'',
			'en'
		)!;
		expect(view.lead).toBe('Opening paragraph here.');
		expect(view.body.trimStart()).toMatch(/^## Next\n/);
	});

	it('links the previous and next page in catalog order', () => {
		expect(docsPageView(docs, '', 'en')).toMatchObject({
			previous: null,
			next: { slug: 'reference/code', title: 'Code page' }
		});
		expect(docsPageView(docs, 'reference/code', 'en')).toMatchObject({
			previous: { slug: '', title: 'Fixture guide' },
			next: null
		});
	});
});
