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
			pathname: '/de/about',
			lang: 'de'
		});

		expect(markdown).toContain('title: "Sample Page"');
		expect(markdown).toContain('route: "/de/about"');
		expect(markdown).toContain('lang_served: "de"');
		expect(markdown).toContain('content_language: "en"');
		expect(markdown).toContain('canonical: "https://example.com/de/about"');
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
		expect(response.headers.get('cache-control')).toContain('s-maxage=300');

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

		expect(llms).toContain('# SaaS Starter');
		expect(llms).toContain('https://example.com/en/about');
		expect(llms).toContain('https://example.com/en/privacy');
		expect(llms).toContain('https://example.com/en/terms');
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
		expect(robots).toContain('Disallow: /en/app');
		expect(robots).toContain('Disallow: /fr/admin');
		expect(robots).toContain('Disallow: /es/emails');
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
		expect(sitemap).toContain('<loc>https://example.com/de/about</loc>');
		expect(sitemap).toContain('<loc>https://example.com/fr/pricing</loc>');
		expect(sitemap).toContain('<loc>https://example.com/en/privacy</loc>');
		expect(sitemap).toContain('<loc>https://example.com/en/terms</loc>');
		expect(sitemap).not.toContain('/en/app');
		expect(sitemap).not.toContain('/en/admin');
	});

	it('returns sitemap responses as xml', () => {
		const response = createSitemapXmlResponse('https://example.com');

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/xml; charset=utf-8');
		expect(response.headers.get('cache-control')).toContain('s-maxage=300');
	});
});
