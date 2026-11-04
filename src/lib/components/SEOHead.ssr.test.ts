// @vitest-environment node

/** The homepage head as the server renders it: one JSON-LD block with the legal identity. */

import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import { LEGAL_CONFIG, getLegalEmailAddress } from '#lib/config/legal.js';
import { SITE_CONFIG, type SiteConfig } from '#lib/config/site.js';

vi.mock('$app/state', () => ({
	page: { url: new URL('https://example.com/en'), params: { lang: 'en' } }
}));
vi.mock('$app/env/public', () => ({ PUBLIC_SITE_URL: 'https://example.com' }));

import SEOHead from './SEOHead.svelte';

function jsonLdBlocks(head: string): unknown[] {
	return [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
		([, json]) => JSON.parse(json!)
	);
}

describe('SEOHead structured data', () => {
	it('renders one graph with the website and the legal organization on the homepage', () => {
		const { head } = render(SEOHead, {
			props: { title: 'Home', description: 'Home description', siteStructuredData: true }
		});
		const blocks = jsonLdBlocks(head);

		expect(blocks).toHaveLength(1);
		const graph = (blocks[0] as { '@graph': Array<Record<string, unknown>> })['@graph'];
		const byType = (type: string) => graph.find((node) => node['@type'] === type);
		// The fork's own legal and site config feed this render, so expectations derive from them.
		const site: SiteConfig = SITE_CONFIG;
		const { streetAddress, postalCode, addressLocality, addressCountry } = LEGAL_CONFIG.address;
		expect(byType('WebSite')).toMatchObject({
			publisher: { '@id': 'https://example.com/#organization' }
		});
		expect(byType('Organization')).toMatchObject({
			'@id': 'https://example.com/#organization',
			name: LEGAL_CONFIG.companyName || LEGAL_CONFIG.operatorName,
			description: site.structuredData.publisher?.description || 'Home description',
			contactPoint: { email: getLegalEmailAddress() },
			address: {
				'@type': 'PostalAddress',
				streetAddress,
				postalCode,
				addressLocality,
				addressCountry
			}
		});
	});
});
