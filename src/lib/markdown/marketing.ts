import type {
	MarketingMarkdownDocument,
	MarketingMarkdownRenderContext,
	MarketingMarkdownSection
} from './types';
import { getLocalizedMarketingUrl, PUBLIC_MARKETING_ROUTES } from '$lib/marketing/public-routes';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from '$lib/i18n/languages';
import { LEGAL_CONFIG } from '$lib/config/legal';
import { getRepositoryDocumentUrl, getRepositoryUrl } from '$lib/config/site';
import { prefersMarkdownHeader } from '$lib/http/accept';

const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8';
const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';
const MARKETING_CACHE_CONTROL = 'public, max-age=0, s-maxage=300, stale-while-revalidate=300';
// Markdown is served on URLs that also serve HTML, negotiated via Accept.
// CF Edge (and most shared caches) ignore Vary, so a public cache would key
// one variant under the URL and serve it for the other Accept value, poisoning
// HTML responses with Markdown (and vice versa). Keep Markdown out of shared
// caches; browsers may still cache it privately.
const MARKDOWN_CACHE_CONTROL = 'private, max-age=300, stale-while-revalidate=300';

interface PublicMarkdownNotFoundContext {
	origin: string;
	lang: string;
	head?: boolean;
}

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
	return prefersMarkdownHeader(request.headers.get('accept'));
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

function appendVary(headers: Headers, value: string): void {
	const entries = (headers.get('Vary') ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
	if (!entries.some((entry) => entry.toLowerCase() === value.toLowerCase())) {
		entries.push(value);
	}
	headers.set('Vary', entries.join(', '));
}

export function renderPublicMarkdownNotFound(origin: string, lang: string): string {
	const homeUrl = getLocalizedMarketingUrl(origin, lang, '');
	const baseOrigin = origin.replace(/\/$/, '');
	return [
		'# 404 Not Found',
		'',
		'No public page exists at this URL.',
		'',
		`- [Read the public page index](${baseOrigin}/llms.txt)`,
		`- [Open the localized homepage](${homeUrl})`,
		`- [Inspect the sitemap](${baseOrigin}/sitemap.xml)`,
		''
	].join('\n');
}

export function createPublicMarkdownNotFoundResponse(
	originalResponse: Response,
	context: PublicMarkdownNotFoundContext
): Response {
	const headers = new Headers(originalResponse.headers);
	for (const name of ['Content-Length', 'Content-Encoding', 'ETag', 'Last-Modified', 'Link']) {
		headers.delete(name);
	}
	headers.set('Content-Type', MARKDOWN_CONTENT_TYPE);
	headers.set('Content-Language', 'en');
	headers.set('Cache-Control', 'no-store');
	appendVary(headers, 'Accept');

	return new Response(
		context.head ? null : renderPublicMarkdownNotFound(context.origin, context.lang),
		{
			status: 404,
			statusText: 'Not Found',
			headers
		}
	);
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
	const canonicalPages = PUBLIC_MARKETING_ROUTES.map(
		(route) =>
			`- [${route.agentLabel}](${getLocalizedMarketingUrl(baseOrigin, DEFAULT_LANGUAGE, route.pathSuffix)}): ${route.agentDescription}`
	);

	return [
		`# ${LEGAL_CONFIG.brandName}`,
		'',
		`> Public marketing content for the ${LEGAL_CONFIG.brandName} SvelteKit template.`,
		'',
		'## Overview',
		'',
		`${LEGAL_CONFIG.brandName} is a full-stack starter built with SvelteKit, Convex, Better Auth, Tolgee, and modern SaaS infrastructure. This file only describes the public marketing pages.`,
		'',
		'## When to use this site',
		'',
		`Use this site to understand what ${LEGAL_CONFIG.brandName} includes, decide whether it fits a SvelteKit SaaS project, review the displayed plans, and read the public legal information for this deployment.`,
		'',
		'For setup, architecture, deployment, customization, contribution, or code-level questions, use the source repository and developer resources below.',
		'',
		'## Canonical pages',
		'',
		...canonicalPages,
		'',
		'## Developer resources',
		'',
		`- [Source repository](${getRepositoryUrl()}): source code, issues, and releases`,
		`- [Developer guide](${getRepositoryDocumentUrl('README.md')}): setup, deployment, architecture, and feature documentation`,
		`- [Repository agent instructions](${getRepositoryDocumentUrl('AGENTS.md')}): conventions for coding agents working with the source`,
		'',
		'## Markdown access',
		'',
		'Send `Accept: text/markdown` to the page URLs above to receive the agent-facing markdown representation.',
		'',
		'## Access limits',
		'',
		'- Google and GitHub OAuth sign end users into the web application. They do not provide delegated access for agents, SDKs, or third-party API clients.',
		'- This template has no supported public integration API, OpenAPI contract, MCP server, or agent action endpoint by default.',
		'- Treat application, Better Auth, Convex, and admin endpoints as internal unless a fork publishes separate API documentation.',
		'- Markdown content is English-only, even when requested on localized route variants.',
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

function isCalendarDate(value: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;
	const [, year, month, day] = match;
	const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
	return date.toISOString().slice(0, 10) === value;
}

export function renderSitemapXml(origin: string): string {
	const baseOrigin = origin.replace(/\/$/, '');

	const urlEntries = PUBLIC_MARKETING_ROUTES.flatMap(({ pathSuffix, lastModified }) => {
		if (lastModified && !isCalendarDate(lastModified)) {
			throw new Error(`Invalid sitemap lastModified date: ${lastModified}`);
		}
		const alternates = [
			...SUPPORTED_LANGUAGES.map(
				(language) =>
					`    <xhtml:link rel="alternate" hreflang="${language.code}" href="${xmlEscape(
						getLocalizedMarketingUrl(baseOrigin, language.code, pathSuffix)
					)}"/>`
			),
			`    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(
				getLocalizedMarketingUrl(baseOrigin, DEFAULT_LANGUAGE, pathSuffix)
			)}"/>`
		].join('\n');

		return SUPPORTED_LANGUAGES.map((language) => {
			const loc = xmlEscape(getLocalizedMarketingUrl(baseOrigin, language.code, pathSuffix));
			const lastModifiedElement = lastModified ? `\n    <lastmod>${lastModified}</lastmod>` : '';
			return `  <url>\n    <loc>${loc}</loc>${lastModifiedElement}\n${alternates}\n  </url>`;
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
