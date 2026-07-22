import type {
	MarketingMarkdownDocument,
	MarketingMarkdownRenderContext,
	MarketingMarkdownSection
} from './types';
import { getLocalizedMarketingUrls, PUBLIC_MARKETING_ROUTES } from '$lib/marketing/public-routes';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from '$lib/i18n/languages';
import { LEGAL_CONFIG } from '$lib/config/legal';

// Captured once at module load so the prerendered sitemap stamps a single
// build date across all URLs, instead of a per-request timestamp.
const BUILD_DATE = new Date().toISOString().slice(0, 10);

const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8';
const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';
const MARKETING_CACHE_CONTROL = 'public, max-age=0, s-maxage=300, stale-while-revalidate=300';
// Markdown is served on URLs that also serve HTML, negotiated via Accept.
// CF Edge (and most shared caches) ignore Vary, so a public cache would key
// one variant under the URL and serve it for the other Accept value, poisoning
// HTML responses with Markdown (and vice versa). Keep Markdown out of shared
// caches; browsers may still cache it privately.
const MARKDOWN_CACHE_CONTROL = 'private, max-age=300, stale-while-revalidate=300';

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
			'Cache-Control': MARKDOWN_CACHE_CONTROL,
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
	const [homeUrl, pricingUrl, privacyUrl, termsUrl, impressumUrl] = getLocalizedMarketingUrls(
		baseOrigin
	).filter((url) => url.startsWith(`${baseOrigin}/en`));

	return [
		`# ${LEGAL_CONFIG.brandName}`,
		'',
		`> Public marketing content for the ${LEGAL_CONFIG.brandName} SvelteKit template.`,
		'',
		'## Overview',
		'',
		`${LEGAL_CONFIG.brandName} is a full-stack starter built with SvelteKit, Convex, Better Auth, Tolgee, and modern SaaS infrastructure. This file only describes the public marketing pages.`,
		'',
		'## Canonical Pages',
		'',
		`- [Home](${homeUrl}): product overview, positioning, and core integrations`,
		`- [Pricing](${pricingUrl}): pricing tiers, included features, and billing notes`,
		`- [Privacy Policy](${privacyUrl}): how personal data is collected, used, and protected`,
		`- [Terms of Service](${termsUrl}): terms and conditions for using the service`,
		`- [Impressum](${impressumUrl}): provider identification and contact details`,
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
	return [
		'User-agent: *',
		'Allow: /',
		'',
		'Disallow: /api/',
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

function localizedMarketingUrl(baseOrigin: string, langCode: string, pathSuffix: string): string {
	return pathSuffix ? `${baseOrigin}/${langCode}${pathSuffix}` : `${baseOrigin}/${langCode}`;
}

export function renderSitemapXml(origin: string): string {
	const baseOrigin = origin.replace(/\/$/, '');

	const urlEntries = PUBLIC_MARKETING_ROUTES.flatMap(({ pathSuffix }) => {
		// hreflang alternates for this route, shared by every localized <url> below.
		const alternates = [
			...SUPPORTED_LANGUAGES.map(
				(language) =>
					`    <xhtml:link rel="alternate" hreflang="${language.code}" href="${xmlEscape(
						localizedMarketingUrl(baseOrigin, language.code, pathSuffix)
					)}"/>`
			),
			`    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(
				localizedMarketingUrl(baseOrigin, DEFAULT_LANGUAGE, pathSuffix)
			)}"/>`
		].join('\n');

		return SUPPORTED_LANGUAGES.map((language) => {
			const loc = xmlEscape(localizedMarketingUrl(baseOrigin, language.code, pathSuffix));
			return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${BUILD_DATE}</lastmod>\n${alternates}\n  </url>`;
		});
	}).join('\n');

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
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
