import { describe, expect, it } from 'vitest';
import { SITE_CONFIG } from '#lib/config/site.js';
import { docsSearchIndex, publishDocs } from './engine';
import { searchDocs, type DocsSearchPage } from './search';
import { publishedCatalog } from './__fixtures__/catalogs';
import { fixtureDocs } from './__fixtures__/fixture-docs';

const index = docsSearchIndex(publishDocs(publishedCatalog, fixtureDocs, SITE_CONFIG.githubSlug)!);

describe('docs search', () => {
	it('finds a page by a word of its body and links the section that holds it', () => {
		expect(searchDocs(index, 'back')).toEqual([
			{
				slug: 'reference/code',
				title: 'Code page',
				section: { id: 'plain-fence', heading: 'Plain fence' }
			}
		]);
	});

	it('finds a word that only a table cell holds and links the heading above the table', () => {
		expect(searchDocs(index, 'bun')).toEqual([
			{
				slug: '',
				title: 'Fixture guide',
				section: { id: 'requirements', heading: 'Requirements' }
			}
		]);
	});

	it('leaves code fences out of the index', () => {
		expect(searchDocs(index, 'adapter')).toEqual([]);
	});

	it('ranks a title match above a text match and lists a page once', () => {
		const pages: DocsSearchPage[] = [
			{
				slug: '',
				title: 'Guide',
				sections: [
					{ id: null, heading: 'Guide', text: 'Read about billing first.' },
					{ id: 'billing', heading: 'Billing', text: 'Billing again.' }
				]
			},
			{ slug: 'billing', title: 'Billing', sections: [{ id: null, heading: 'Billing', text: '' }] }
		];
		expect(searchDocs(pages, 'billing').map((result) => result.slug)).toEqual(['billing', '']);
	});

	it('uses the heading ids of the page', () => {
		const ids = index.flatMap((page) => page.sections.map((section) => section.id));
		expect(ids).toContain('example-1');
		expect(ids).toContain('an-emphasis-and-code-heading');
	});
});
