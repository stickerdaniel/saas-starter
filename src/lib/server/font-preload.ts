import type { Handle } from '@sveltejs/kit';
import { preloads } from 'fontless/runtime';

/** Inline the homepage's critical font; preload the full font on other pages. */
export const handleFontPreload: Handle = async ({ event, resolve }) => {
	// The build creates this module after Kit has analyzed the server routes.
	const inlineCriticalFont =
		event.route.id === '/[[lang]]/(marketing)'
			? (await import('virtual:marketing-fonts/server')).default
			: null;
	const response = await resolve(event, {
		// Keep charset in the first 1024 bytes, then start decoding before other styles.
		transformPageChunk: ({ html }) =>
			inlineCriticalFont
				? html.replace(
						/<meta charset="utf-8"\s*\/?>/i,
						(charset) =>
							`${charset}<link rel="preload" as="font" type="font/woff2" href="${inlineCriticalFont.href}" crossorigin><style>${inlineCriticalFont.css}</style>`
					)
				: html
	});
	if (!response.headers.get('content-type')?.startsWith('text/html')) return response;
	// Other text can request the full font as needed without delaying the hero.
	if (inlineCriticalFont) return response;

	const fonts = [...new Set(preloads.map(({ href }) => href))];
	if (fonts.length === 0) return response;
	const links = fonts.map(
		(href) => `<${href}>; rel=preload; as=font; crossorigin; fetchpriority=high`
	);
	const existing = response.headers.get('link');
	if (existing) links.push(existing);
	response.headers.set('link', links.join(', '));
	return response;
};
