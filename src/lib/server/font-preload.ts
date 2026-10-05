import type { Handle } from '@sveltejs/kit';
import { preloads } from 'fontless/runtime';

/** Start fonts from the response headers, before the browser parses inline CSS. */
export const handleFontPreload: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	if (!response.headers.get('content-type')?.startsWith('text/html')) return response;

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
