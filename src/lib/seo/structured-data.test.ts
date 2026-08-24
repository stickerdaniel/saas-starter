import { describe, expect, it } from 'vitest';
import { buildSiteStructuredData, serializeStructuredData } from './structured-data';

const baseInput = {
	origin: 'https://example.com/',
	name: 'Example',
	description: 'Example description',
	languages: ['en', 'de'],
	repositoryUrl: 'https://github.com/example/app'
} as const;

describe('site structured data', () => {
	it('builds a stable WebSite graph without inferred publisher identity', () => {
		const data = buildSiteStructuredData(baseInput) as { '@graph': Array<Record<string, unknown>> };

		expect(data['@graph']).toEqual([
			{
				'@type': 'WebSite',
				'@id': 'https://example.com/#website',
				url: 'https://example.com/',
				name: 'Example',
				description: 'Example description',
				inLanguage: ['en', 'de'],
				sameAs: ['https://github.com/example/app']
			}
		]);
		expect(JSON.stringify(data)).not.toContain('Organization');
		expect(JSON.stringify(data)).not.toContain('SoftwareApplication');
	});

	it('adds a configured publisher and logo with stable references', () => {
		const data = buildSiteStructuredData({
			...baseInput,
			publisher: {
				name: 'Example Org',
				logo: { path: '/logo.svg', width: 128, height: 128 },
				sameAs: ['https://social.example/example']
			}
		}) as { '@graph': Array<Record<string, unknown>> };

		expect(data['@graph']).toHaveLength(3);
		expect(data['@graph'][0]).toMatchObject({
			publisher: { '@id': 'https://example.com/#organization' }
		});
		expect(data['@graph'][1]).toMatchObject({
			'@type': 'ImageObject',
			url: 'https://example.com/logo.svg'
		});
		expect(data['@graph'][2]).toMatchObject({
			'@type': 'Organization',
			logo: { '@id': 'https://example.com/#organization-logo' }
		});
	});

	it('rejects non-public identity URLs without echoing their values', () => {
		for (const value of ['javascript:alert(1)', 'https://user:secret@example.com', 'not a url']) {
			expect(() => buildSiteStructuredData({ ...baseInput, repositoryUrl: value })).toThrow(
				/^Structured data URL must be a public HTTP\(S\) URL\.$/
			);
		}
	});

	it('escapes script raw-text delimiters and round-trips as JSON', () => {
		const value = { text: '</script><script>alert("x")</script>&' + '\u2028' + '\u2029' };
		const serialized = serializeStructuredData(value);

		expect(serialized).not.toContain('</script>');
		expect(serialized).toContain('\\u003C');
		expect(JSON.parse(serialized)).toEqual(value);
	});
});
