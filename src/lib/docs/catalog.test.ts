import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { docsCatalog } from './catalog';
import { UNPUBLISHED_DOCS } from './starter-pages';

const markdownFiles = readdirSync('docs', { recursive: true, encoding: 'utf8' })
	.filter((file) => file.endsWith('.md'))
	.map((file) => `docs/${file.split('\\').join('/')}`);

describe('the starter catalog', () => {
	it('names every Markdown file under docs/ in exactly one of its two lists', () => {
		const listed = [...docsCatalog.pages.map((page) => page.source), ...UNPUBLISHED_DOCS];
		expect(listed.toSorted()).toEqual(markdownFiles.toSorted());
	});
});
