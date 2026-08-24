import { describe, expect, it } from 'vitest';
import {
	githubSlugProperty,
	isValidGithubRepository,
	replaceGithubSlugSource,
	replaceLegalContentDatesSource,
	updateLegalContentDatesSource
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
		'owner-/repo',
		'owner--name/repo',
		'owner/repository.git',
		`${'a'.repeat(40)}/repo`,
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

describe('template setup legal dates', () => {
	const source = `export const LEGAL_CONTENT_DATES = {
	privacy: '2026-03-18',
	terms: '2026-03-18',
	impressum: '2026-03-21'
} as const;`;

	it('dates every rewritten legal document with the setup date', () => {
		const updated = replaceLegalContentDatesSource(source, '2026-08-24');
		expect(updated.match(/2026-08-24/g)).toHaveLength(3);
	});

	it('preserves legal dates when the legal identity is unchanged', () => {
		expect(updateLegalContentDatesSource(source, '2026-08-24', false)).toBe(source);
	});

	it('fails before writes when the metadata shape has drifted', () => {
		expect(() =>
			replaceLegalContentDatesSource(source.replace("impressum: '2026-03-21'", ''), '2026-08-24')
		).toThrow(/Could not update every date/);
	});
});
