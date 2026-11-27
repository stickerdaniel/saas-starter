import { SITE_CONFIG } from '#lib/config/site.js';
import { docsSource } from '../source';
import type { DocsCatalog, DocsPageEntry } from '../types';

const pages: readonly DocsPageEntry[] = [
	{ source: 'src/lib/docs/__fixtures__/docs/guide.md', slug: '', section: 'Guides' },
	{
		source: 'src/lib/docs/__fixtures__/docs/reference/code.md',
		slug: 'reference/code',
		section: 'Reference'
	}
];

export const publishedCatalog: DocsCatalog = { site: SITE_CONFIG.githubSlug, pages };

export const foreignSiteCatalog: DocsCatalog = { site: 'example/another-site', pages };

export const emptyCatalog: DocsCatalog = { site: SITE_CONFIG.githubSlug, pages: [] };

export const fixtureDocs = docsSource(
	'src/lib/docs/__fixtures__/docs/',
	import.meta.glob<string>('/src/lib/docs/__fixtures__/docs/**/*.md', {
		query: '?raw',
		import: 'default',
		eager: true
	}),
	import.meta.glob<string>('/src/lib/docs/__fixtures__/docs/assets/*', {
		query: '?url',
		import: 'default',
		eager: true
	})
);
