import { describe, expect, it } from 'vitest';
import {
	createLlmsTxtResponse,
	createMarketingMarkdownResponse,
	createMarkdownNotAcceptableResponse,
	createRobotsTxtResponse,
	createSitemapXmlResponse,
	isMarkdownRequest,
	renderLlmsTxt,
	renderMarketingMarkdown,
	renderRobotsTxt,
	renderSitemapXml
} from './marketing';
import type { MarketingMarkdownDocument } from './types';
import { marketingMarkdown as homeMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/page.md';
import { LEGAL_CONFIG } from '$lib/config/legal';

const sampleDocument: MarketingMarkdownDocument = {
	title: 'Sample Page',
	description: 'A concise summary for agents.',
	sections: [
		{
			heading: 'Overview',
			paragraphs: ['One paragraph.'],
			bullets: ['First bullet', 'Second bullet']
		}
	]
};

describe('marketing markdown helpers', () => {
	it('detects markdown accept headers case-insensitively', () => {
		expect(
			isMarkdownRequest(
				new Request('https://example.com/en', {
					headers: {
						Accept: 'text/markdown, text/html;q=0.8'
					}
				})
			)
		).toBe(true);

		expect(
			isMarkdownRequest(
				new Request('https://example.com/en', {
					headers: {
						Accept: 'text/html, application/xhtml+xml'
					}
				})
			)
		).toBe(false);
	});

	it('renders frontmatter with requested route metadata', () => {
		const markdown = renderMarketingMarkdown(sampleDocument, {
			origin: 'https://example.com',
			pathname: '/de/pricing',
			lang: 'de'
		});

		expect(markdown).toContain('title: "Sample Page"');
		expect(markdown).toContain('route: "/de/pricing"');
		expect(markdown).toContain('lang_served: "de"');
		expect(markdown).toContain('content_language: "en"');
		expect(markdown).toContain('canonical: "https://example.com/de/pricing"');
		expect(markdown).toContain('## Overview');
		expect(markdown).toContain('- First bullet');
	});

	it('returns markdown responses with caching and vary headers', async () => {
		const response = createMarketingMarkdownResponse(homeMarketingMarkdown, {
			origin: 'https://example.com',
			pathname: '/de',
			lang: 'de'
		});

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
		expect(response.headers.get('vary')).toBe('Accept');
		// Markdown must stay out of shared caches: CF Edge (and most CDNs) ignore Vary,
		// so any edge-cacheable markdown would poison subsequent HTML requests on the same URL.
		expect(response.headers.get('cache-control')).toContain('private');
		expect(response.headers.get('cache-control')).not.toContain('s-maxage');

		const body = await response.text();
		expect(body).toContain('# Build & Ship Your Product Faster');
		expect(body).toContain('lang_served: "de"');
		expect(body).toContain('content_language: "en"');
	});

	it('returns a 406 response when markdown is not accepted', async () => {
		const response = createMarkdownNotAcceptableResponse();

		expect(response.status).toBe(406);
		expect(response.headers.get('vary')).toBe('Accept');
		expect(await response.text()).toBe('Not Acceptable');
	});

	it('renders llms discovery content with canonical marketing links', () => {
		const llms = renderLlmsTxt('https://example.com');

		expect(llms).toContain(`# ${LEGAL_CONFIG.brandName}`);
		expect(llms).toContain('https://example.com/en/privacy');
		expect(llms).toContain('https://example.com/en/terms');
		expect(llms).toContain('https://example.com/en/impressum');
		expect(llms).toContain('Accept: text/markdown');
	});

	it('returns llms responses as plain text', () => {
		const response = createLlmsTxtResponse('https://example.com');

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
	});

	it('renders robots.txt with explicit disallow rules and sitemap reference', () => {
		const robots = renderRobotsTxt('https://example.com');

		expect(robots).toContain('User-agent: *');
		expect(robots).toContain('Allow: /');
		expect(robots).toContain('Disallow: /api/');
		// Private app/admin routes are kept out via per-page noindex, not robots.txt
		expect(robots).not.toContain('Disallow: /en/app');
		expect(robots).not.toContain('Disallow: /en/admin');
		expect(robots).toContain('Sitemap: https://example.com/sitemap.xml');
	});

	it('returns robots.txt responses as plain text', () => {
		const response = createRobotsTxtResponse('https://example.com');

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
		expect(response.headers.get('cache-control')).toContain('s-maxage=300');
	});

	it('renders sitemap.xml with all localized public marketing URLs', () => {
		const sitemap = renderSitemapXml('https://example.com');

		expect(sitemap).toContain('<?xml version="1.0" encoding="UTF-8"?>');
		expect(sitemap).toContain('<loc>https://example.com/en</loc>');
		expect(sitemap).toContain('<loc>https://example.com/fr/pricing</loc>');
		expect(sitemap).toContain('<loc>https://example.com/en/privacy</loc>');
		expect(sitemap).toContain('<loc>https://example.com/en/terms</loc>');
		expect(sitemap).toContain('<loc>https://example.com/en/impressum</loc>');
		expect(sitemap).not.toContain('/en/app');
		expect(sitemap).not.toContain('/en/admin');
	});

	it('declares the xhtml namespace for hreflang alternates', () => {
		const sitemap = renderSitemapXml('https://example.com');

		expect(sitemap).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
	});

	it('emits a full hreflang alternate group with x-default per route', () => {
		const sitemap = renderSitemapXml('https://example.com');

		// One alternate per supported language plus x-default, all pointing at the
		// pricing route variants.
		expect(sitemap).toContain(
			'<xhtml:link rel="alternate" hreflang="en" href="https://example.com/en/pricing"/>'
		);
		expect(sitemap).toContain(
			'<xhtml:link rel="alternate" hreflang="de" href="https://example.com/de/pricing"/>'
		);
		expect(sitemap).toContain(
			'<xhtml:link rel="alternate" hreflang="es" href="https://example.com/es/pricing"/>'
		);
		expect(sitemap).toContain(
			'<xhtml:link rel="alternate" hreflang="fr" href="https://example.com/fr/pricing"/>'
		);
		expect(sitemap).toContain(
			'<xhtml:link rel="alternate" hreflang="x-default" href="https://example.com/en/pricing"/>'
		);

		// x-default points at the home route's default-language URL too.
		expect(sitemap).toContain(
			'<xhtml:link rel="alternate" hreflang="x-default" href="https://example.com/en"/>'
		);
	});

	it('stamps every url with an ISO lastmod date', () => {
		const sitemap = renderSitemapXml('https://example.com');

		const lastmodMatches = sitemap.match(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g) ?? [];
		const urlCount = (sitemap.match(/<url>/g) ?? []).length;

		expect(urlCount).toBeGreaterThan(0);
		expect(lastmodMatches).toHaveLength(urlCount);
	});

	it('returns sitemap responses as xml', () => {
		const response = createSitemapXmlResponse('https://example.com');

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/xml; charset=utf-8');
		expect(response.headers.get('cache-control')).toContain('s-maxage=300');
	});
});
