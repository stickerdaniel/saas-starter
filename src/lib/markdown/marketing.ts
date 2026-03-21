import type {
	MarketingMarkdownDocument,
	MarketingMarkdownRenderContext,
	MarketingMarkdownSection
} from './types';
import { getLocalizedMarketingUrls } from '$lib/marketing/public-routes';
import { SUPPORTED_LANGUAGES } from '$lib/i18n/languages';

const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8';
const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';
const MARKETING_CACHE_CONTROL = 'public, max-age=0, s-maxage=300, stale-while-revalidate=300';

function quoteFrontmatterValue(value: string): string {
	return JSON.stringify(value);
}

function renderSection(section: MarketingMarkdownSection): string {
	const parts: string[] = [`## ${section.heading}`];

	for (const paragraph of section.paragraphs ?? []) {
		parts.push(paragraph);
	}

	if (section.bullets?.length) {
		parts.push(section.bullets.map((bullet) => `- ${bullet}`).join('\n'));
	}

	if (section.links?.length) {
		parts.push(
			section.links
				.map((link) =>
					link.description
						? `- [${link.label}](${link.href}): ${link.description}`
						: `- [${link.label}](${link.href})`
				)
				.join('\n')
		);
	}

	return parts.join('\n\n');
}

export function isMarkdownRequest(request: Request): boolean {
	const accept = request.headers.get('accept') ?? '';
	return /\btext\/markdown\b/i.test(accept);
}

export function renderMarketingMarkdown(
	document: MarketingMarkdownDocument,
	context: MarketingMarkdownRenderContext
): string {
	const canonicalPath = document.canonicalPath ?? context.pathname;
	const canonical = new URL(canonicalPath, context.origin).toString();
	const frontmatterEntries = [
		['title', document.title],
		['description', document.description],
		['canonical', canonical],
		['route', context.pathname],
		['lang_served', context.lang],
		['content_language', 'en'],
		['content_type', 'marketing-page']
	];

	if (document.robots) {
		frontmatterEntries.push(['robots', document.robots]);
	}

	const frontmatter = [
		'---',
		...frontmatterEntries.map(([key, value]) => `${key}: ${quoteFrontmatterValue(value!)}`),
		'---'
	].join('\n');

	const body = [
		`# ${document.title}`,
		document.description,
		...document.sections.map((section) => renderSection(section))
	].join('\n\n');

	return `${frontmatter}\n\n${body}\n`;
}

export function createMarketingMarkdownResponse(
	document: MarketingMarkdownDocument,
	context: MarketingMarkdownRenderContext
): Response {
	return new Response(renderMarketingMarkdown(document, context), {
		status: 200,
		headers: {
			'Content-Type': MARKDOWN_CONTENT_TYPE,
			'Cache-Control': MARKETING_CACHE_CONTROL,
			Vary: 'Accept'
		}
	});
}

export function createMarkdownNotAcceptableResponse(): Response {
	return new Response('Not Acceptable', {
		status: 406,
		headers: {
			'Content-Type': TEXT_CONTENT_TYPE,
			'Cache-Control': 'no-store',
			Vary: 'Accept'
		}
	});
}

export function createMarketingMarkdownErrorResponse(): Response {
	return new Response('Failed to render marketing markdown.', {
		status: 500,
		headers: {
			'Content-Type': TEXT_CONTENT_TYPE,
			'Cache-Control': 'no-store',
			Vary: 'Accept'
		}
	});
}

function xmlEscape(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

export function renderLlmsTxt(origin: string): string {
	const baseOrigin = origin.replace(/\/$/, '');
	const [homeUrl, aboutUrl, pricingUrl, privacyUrl, termsUrl] = getLocalizedMarketingUrls(
		baseOrigin
	).filter((url) => url.startsWith(`${baseOrigin}/en`));

	return [
		'# SaaS Starter',
		'',
		'> Public marketing content for the SaaS Starter SvelteKit template.',
		'',
		'## Overview',
		'',
		'SaaS Starter is a full-stack starter built with SvelteKit, Convex, Better Auth, Tolgee, and modern SaaS infrastructure. This file only describes the public marketing pages.',
		'',
		'## Canonical Pages',
		'',
		`- [Home](${homeUrl}): product overview, positioning, and core integrations`,
		`- [About](${aboutUrl}): team overview and roles`,
		`- [Pricing](${pricingUrl}): pricing tiers, included features, and billing notes`,
		`- [Privacy Policy](${privacyUrl}): how personal data is collected, used, and protected`,
		`- [Terms of Service](${termsUrl}): terms and conditions for using the service`,
		'',
		'## Markdown Access',
		'',
		'Send `Accept: text/markdown` to the page URLs above to receive the agent-facing markdown representation.',
		'',
		'## Notes',
		'',
		'- Markdown content is English-only in v1, even when requested on localized route variants.',
		'- Authenticated application routes, admin routes, and API endpoints are intentionally excluded.',
		''
	].join('\n');
}

export function createLlmsTxtResponse(origin: string): Response {
	return new Response(renderLlmsTxt(origin), {
		status: 200,
		headers: {
			'Content-Type': TEXT_CONTENT_TYPE,
			'Cache-Control': MARKETING_CACHE_CONTROL
		}
	});
}

export function renderRobotsTxt(origin: string): string {
	const baseOrigin = origin.replace(/\/$/, '');
	const disallowLines = SUPPORTED_LANGUAGES.flatMap((language) => [
		`Disallow: /${language.code}/app`,
		`Disallow: /${language.code}/admin`,
		`Disallow: /${language.code}/emails`
	]);

	return [
		'User-agent: *',
		'Allow: /',
		'',
		'Disallow: /api/',
		...disallowLines,
		'',
		`Sitemap: ${baseOrigin}/sitemap.xml`,
		''
	].join('\n');
}

export function createRobotsTxtResponse(origin: string): Response {
	return new Response(renderRobotsTxt(origin), {
		status: 200,
		headers: {
			'Content-Type': TEXT_CONTENT_TYPE,
			'Cache-Control': MARKETING_CACHE_CONTROL
		}
	});
}

export function renderSitemapXml(origin: string): string {
	const urls = getLocalizedMarketingUrls(origin);
	const urlEntries = urls
		.map((url) => `  <url>\n    <loc>${xmlEscape(url)}</loc>\n  </url>`)
		.join('\n');

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		urlEntries,
		'</urlset>',
		''
	].join('\n');
}

export function createSitemapXmlResponse(origin: string): Response {
	return new Response(renderSitemapXml(origin), {
		status: 200,
		headers: {
			'Content-Type': 'application/xml; charset=utf-8',
			'Cache-Control': MARKETING_CACHE_CONTROL
		}
	});
}
