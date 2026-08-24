import { describe, expect, it } from 'vitest';
import { SITE_CONFIG, getRepositoryDocumentUrl, getRepositoryUrl } from './site';

describe('site configuration', () => {
	it('derives runtime repository links from one slug', () => {
		expect(getRepositoryUrl()).toBe(`https://github.com/${SITE_CONFIG.githubSlug}`);
		expect(getRepositoryDocumentUrl('/README.md')).toBe(
			`https://raw.githubusercontent.com/${SITE_CONFIG.githubSlug}/HEAD/README.md`
		);
	});
});
