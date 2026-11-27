import { describe, expect, it } from 'vitest';
import { SITE_CONFIG } from '#lib/config/site.js';
import { docsPageView, publishDocs } from './engine';
import type { DocsHeading } from './headings';
import {
	emptyCatalog,
	fixtureDocs,
	foreignSiteCatalog,
	publishedCatalog
} from './__fixtures__/catalogs';

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
			'alerts',
			'links-outside-the-docs'
		]);
	});
});
