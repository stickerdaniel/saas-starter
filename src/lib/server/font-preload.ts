import type { Handle } from '@sveltejs/kit/hooks';
import { preloads } from 'fontless/runtime';
import { criticalFontScope } from '#lib/font-loading.js';

/** Inline public-page fonts; preload the full font for application pages. */
export const handleFontPreload: Handle = async ({ event, resolve }) => {
	// The build creates this module after Kit has analyzed the server routes.
	const scope = criticalFontScope(event.route.id);
	const fonts = scope ? (await import('virtual:marketing-fonts/server')).default : null;
	const inlineCriticalFont = scope ? fonts?.[scope] : null;
	const formPage = event.route.id?.startsWith('/[[lang]]/(auth)/');
	const scriptPreloads = new Set<string>();
	const response = await resolve(event, {
		// Let the document arrive before scripts compete for bandwidth. Forms still
		// preload their full module graph so fields become usable without a waterfall.
		preload:
			scope === 'public' && inlineCriticalFont
				? ({ type, path }) => {
						if (type === 'js' && formPage) scriptPreloads.add(path);
						return type === 'css';
					}
				: undefined,
		// Keep charset in the first 1024 bytes, then start decoding before other styles.
		transformPageChunk: ({ html }) => {
			if (!inlineCriticalFont) return html;
			if (scope === 'public') {
				// Decode before layout: even invisible text uses fallback `ch` widths.
				// Keep the face after Fontless's declarations so the inline source wins.
				const scripts = [...scriptPreloads]
					.map((href) => `<link rel="modulepreload" href="${encodeURI(href)}" fetchpriority="low">`)
					.join('');
				return html
					.replace(
						/<meta charset="utf-8"\s*\/?>/i,
						(charset) =>
							`${charset}<link rel="preload" as="font" type="font/woff2" href="${inlineCriticalFont.href}" crossorigin>`
					)
					.replace('</head>', `<style>${inlineCriticalFont.css}</style>${scripts}</head>`);
			}
			return html.replace(
				/<meta charset="utf-8"\s*\/?>/i,
				(charset) =>
					`${charset}<link rel="preload" as="font" type="font/woff2" href="${inlineCriticalFont.href}" crossorigin><style>${inlineCriticalFont.css}</style>`
			);
		}
	});
	if (!response.headers.get('content-type')?.startsWith('text/html')) return response;
	// Other text can request the full font as needed without delaying the hero.
	if (inlineCriticalFont) return response;

	const fontHrefs = [...new Set(preloads.map(({ href }) => href))];
	if (fontHrefs.length === 0) return response;
	const links = fontHrefs.map(
		(href) => `<${href}>; rel=preload; as=font; crossorigin; fetchpriority=high`
	);
	const existing = response.headers.get('link');
	if (existing) links.push(existing);
	response.headers.set('link', links.join(', '));
	return response;
};
