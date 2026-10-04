import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseThirdPartyLicensesConfig } from './config';
import { renderGeneratedNotice } from './generated';

const root = path.resolve('/repo');
const source = 'https://github.com/example/pkg/blob/v1.0.0/LICENSE';

function parse(input: unknown) {
	return () => parseThirdPartyLicensesConfig(input, root);
}

describe('third-party license configuration', () => {
	it('accepts overrides with one notice source or only a declaration correction', () => {
		const config = parseThirdPartyLicensesConfig(
			{
				packageOverrides: [
					{ name: 'a', version: '1.0.0', sourceUrl: source, noticeFiles: ['notices/a.txt'] },
					{
						name: 'b',
						version: '1.0.0',
						sourceUrl: source,
						generatedNotices: [{ licenseId: 'MIT', copyrights: ['Copyright (c) 2024 B'] }]
					},
					{ name: 'c', version: '1.0.0', sourceUrl: source, license: 'MIT' }
				]
			},
			root
		);
		expect(config.packageOverrides.map((override) => override.name)).toEqual(['a', 'b', 'c']);
		expect(config.extraPackages).toEqual([]);
	});

	it('rejects an override that combines noticeFiles and generatedNotices', () => {
		expect(
			parse({
				packageOverrides: [
					{
						name: 'a',
						version: '1.0.0',
						sourceUrl: source,
						noticeFiles: ['notices/a.txt'],
						generatedNotices: [{ licenseId: 'Apache-2.0' }]
					}
				]
			})
		).toThrow('Use either noticeFiles or generatedNotices');
	});

	it('rejects an override without a correction or notice source', () => {
		expect(
			parse({ packageOverrides: [{ name: 'a', version: '1.0.0', sourceUrl: source }] })
		).toThrow(
			'needs a license correction, noticeFiles, generatedNotices, or supplementalNoticeFiles'
		);
	});

	it('requires copyright lines for licenses whose template has a placeholder', () => {
		expect(
			parse({
				packageOverrides: [
					{
						name: 'a',
						version: '1.0.0',
						sourceUrl: source,
						generatedNotices: [{ licenseId: 'MIT' }]
					}
				]
			})
		).toThrow('MIT needs "copyrights"');
	});

	it('rejects license expressions and unknown identifiers as generated notices', () => {
		expect(
			parse({
				packageOverrides: [
					{
						name: 'a',
						version: '1.0.0',
						sourceUrl: source,
						generatedNotices: [{ licenseId: 'MIT OR Apache-2.0' }]
					}
				]
			})
		).toThrow('is not a single license identifier');
	});

	it('rejects duplicate overrides and custom notice ids', () => {
		const override = { name: 'a', version: '1.0.0', sourceUrl: source, license: 'MIT' };
		const custom = {
			id: 'asset',
			name: 'Asset',
			components: ['assets'],
			license: 'CC0-1.0',
			sourceUrl: source,
			generatedNotices: [{ licenseId: 'CC0-1.0' }]
		};
		const run = parse({ packageOverrides: [override, override], customNotices: [custom, custom] });
		expect(run).toThrow('Duplicate package override for a@1.0.0.');
		expect(run).toThrow('Duplicate custom notice id "asset".');
	});

	it.each(['ftp://example.com/LICENSE', 'javascript:alert(1)', 'not a url'])(
		'rejects the non-http sourceUrl %s',
		(sourceUrl) => {
			expect(
				parse({ packageOverrides: [{ name: 'a', version: '1.0.0', sourceUrl, license: 'MIT' }] })
			).toThrow('packageOverrides.0.sourceUrl');
		}
	);

	it('rejects notice files outside the repository', () => {
		expect(
			parse({
				packageOverrides: [
					{ name: 'a', version: '1.0.0', sourceUrl: source, noticeFiles: ['../outside.txt'] }
				]
			})
		).toThrow('must be a path inside the repository');
	});
});

describe('generated notices', () => {
	it.each([
		['MIT', 'Copyright (c) <year> <copyright holders>'],
		['BSD-2-Clause', '<owner>'],
		['BSD-3-Clause', '<owner>'],
		['0BSD', 'YEAR by AUTHOR EMAIL'],
		['ISC', 'Internet Systems Consortium']
	])('replaces the %s copyright placeholder with the supplied lines', (licenseId, placeholder) => {
		const text = renderGeneratedNotice({
			licenseId,
			copyrights: ['Copyright (c) 2024 Example Holder', 'Copyright (c) 2025 Second Holder']
		});
		expect(text).not.toContain(placeholder);
		expect(text).toContain('Copyright (c) 2024 Example Holder\nCopyright (c) 2025 Second Holder');
	});

	it('puts the preamble first and keeps the license text otherwise intact', () => {
		const text = renderGeneratedNotice({
			licenseId: 'CC-BY-4.0',
			preamble: ['"Work" by Author. No modifications.']
		});
		expect(
			text.startsWith('"Work" by Author. No modifications.\n\nCreative Commons Attribution 4.0')
		).toBe(true);
	});
});
