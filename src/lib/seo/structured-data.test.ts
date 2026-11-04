import { describe, expect, it } from 'vitest';
import { buildSiteStructuredData, serializeStructuredData } from './structured-data';

type Graph = { '@graph': Array<Record<string, unknown>> };

const baseInput = {
	origin: 'https://example.com/',
	name: 'Example',
	description: 'Example description',
	languages: ['en', 'de'],
	repositoryUrl: 'https://github.com/example/app',
	legal: {
		companyName: 'Example Inc.',
		operatorName: 'Jane Doe',
		address: {
			streetAddress: '1 Example Way',
			postalCode: '94102',
			addressLocality: 'San Francisco',
			addressCountry: 'US'
		},
		email: 'hello@example.com'
	}
} as const;

const forkLegal = {
	companyName: 'Northwind Labs GmbH',
	operatorName: 'Anne Weber',
	address: {
		streetAddress: 'Hauptstrasse 5',
		postalCode: '12345',
		addressLocality: 'Berlin',
		addressCountry: 'DE'
	},
	email: 'kontakt@northwind-labs.de'
};

describe('site structured data', () => {
	it('publishes the website and its legal organization as one linked graph', () => {
		const data = buildSiteStructuredData(baseInput) as Graph;

		expect(data['@graph']).toEqual([
			{
				'@type': 'WebSite',
				'@id': 'https://example.com/#website',
				url: 'https://example.com/',
				name: 'Example',
				description: 'Example description',
				inLanguage: ['en', 'de'],
				sameAs: ['https://github.com/example/app'],
				publisher: { '@id': 'https://example.com/#organization' }
			},
			{
				'@type': 'Organization',
				'@id': 'https://example.com/#organization',
				name: 'Example Inc.',
				url: 'https://example.com/',
				contactPoint: {
					'@type': 'ContactPoint',
					contactType: 'customer support',
					email: 'hello@example.com'
				},
				address: {
					'@type': 'PostalAddress',
					streetAddress: '1 Example Way',
					postalCode: '94102',
					addressLocality: 'San Francisco',
					addressCountry: 'US'
				}
			}
		]);
		expect(JSON.stringify(data)).not.toContain('SoftwareApplication');
	});

	it('renders a fork identity at the fork origin', () => {
		const data = buildSiteStructuredData({
			...baseInput,
			origin: 'https://northwind-labs.de',
			legal: forkLegal
		}) as Graph;

		expect(data['@graph'][1]).toMatchObject({
			'@id': 'https://northwind-labs.de/#organization',
			name: 'Northwind Labs GmbH',
			url: 'https://northwind-labs.de/',
			contactPoint: { email: 'kontakt@northwind-labs.de' },
			address: {
				streetAddress: 'Hauptstrasse 5',
				postalCode: '12345',
				addressLocality: 'Berlin',
				addressCountry: 'DE'
			}
		});
		expect(JSON.stringify(data)).not.toContain('Example Inc.');
		expect(JSON.stringify(data)).not.toContain('example.com/#organization');
	});

	it('names a fork without a company after its operator', () => {
		const data = buildSiteStructuredData({
			...baseInput,
			legal: { ...forkLegal, companyName: '' }
		}) as Graph;

		expect(data['@graph'][1]).toMatchObject({ '@type': 'Organization', name: 'Anne Weber' });
	});

	it('adds the configured organization profile without mixing in repository links', () => {
		const data = buildSiteStructuredData({
			...baseInput,
			publisher: {
				description: 'Example builds examples.',
				logo: { path: '/logo.svg', width: 128, height: 128 },
				sameAs: ['https://social.example/example']
			}
		}) as Graph;

		expect(data['@graph']).toHaveLength(3);
		expect(data['@graph'][0]).toMatchObject({
			sameAs: ['https://github.com/example/app'],
			publisher: { '@id': 'https://example.com/#organization' }
		});
		expect(data['@graph'][1]).toMatchObject({
			'@type': 'ImageObject',
			'@id': 'https://example.com/#organization-logo',
			url: 'https://example.com/logo.svg'
		});
		expect(data['@graph'][2]).toMatchObject({
			'@type': 'Organization',
			name: 'Example Inc.',
			description: 'Example builds examples.',
			sameAs: ['https://social.example/example'],
			logo: { '@id': 'https://example.com/#organization-logo' }
		});
	});

	it('rejects non-public identity URLs without echoing their values', () => {
		for (const value of ['javascript:alert(1)', 'https://user:secret@example.com', 'not a url']) {
			expect(() => buildSiteStructuredData({ ...baseInput, repositoryUrl: value })).toThrow(
				/^Structured data URL must be a public HTTP\(S\) URL\.$/
			);
			expect(() =>
				buildSiteStructuredData({ ...baseInput, publisher: { sameAs: [value] } })
			).toThrow(/^Structured data URL must be a public HTTP\(S\) URL\.$/);
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
