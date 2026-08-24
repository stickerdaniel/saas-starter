import { describe, expect, it } from 'vitest';
import {
	githubSlugProperty,
	isValidGithubRepository,
	replaceGithubSlugSource
} from './template-setup';

describe('template setup repository configuration', () => {
	it.each(['owner/repo', 'owner-name/repo.name', 'Owner123/repo_name'])('accepts %s', (value) => {
		expect(isValidGithubRepository(value)).toBe(true);
	});

	it.each([
		'owner',
		'owner/repo/extra',
		'owner/repo"; console.log(1)',
		'owner name/repo',
		'/repo',
		'owner/.',
		'owner/..'
	])('rejects unsafe repository value %s', (value) => {
		expect(isValidGithubRepository(value)).toBe(false);
		expect(() => githubSlugProperty(value)).toThrow(/Invalid GitHub repository/);
	});

	it('updates the central slug and is idempotent', () => {
		const source = "export const SITE_CONFIG = {\n\tgithubSlug: 'old-owner/old-repo'\n};\n";
		const first = replaceGithubSlugSource(source, 'new-owner/new-repo');
		const second = replaceGithubSlugSource(first, 'new-owner/new-repo');

		expect(first).toContain("githubSlug: 'new-owner/new-repo'");
		expect(second).toBe(first);
	});

	it('fails when the configuration shape has drifted', () => {
		expect(() => replaceGithubSlugSource('export const SITE_CONFIG = {};', 'owner/repo')).toThrow(
			/Could not find githubSlug/
		);
	});
});
