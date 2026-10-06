import { describe, expect, it, vi } from 'vitest';

vi.mock('fontless/runtime', () => ({
	preloads: [{ href: '/_fonts/outfit.woff2' }, { href: '/_fonts/outfit.woff2' }]
}));
vi.mock('virtual:marketing-fonts/server', () => {
	const href = `data:font/woff2;base64,d09GMg${'A'.repeat(2048)}==`;
	return { default: { css: `@font-face{font-family:Critical;src:url(${href})}`, href } };
});

import { handleFontPreload } from './font-preload';

describe('HTML font preloads', () => {
	it('advertises the font once without replacing existing resource hints or the body', async () => {
		const response = new Response('<h1>Headline</h1>', {
			headers: {
				'content-type': 'text/html; charset=utf-8',
				link: '</app.js>; rel=modulepreload'
			}
		});
		const result = await handleFontPreload({
			event: { route: { id: '/[[lang]]/(marketing)/pricing' } } as never,
			resolve: async () => response
		});
		expect(result.headers.get('link')).toBe(
			'</_fonts/outfit.woff2>; rel=preload; as=font; crossorigin; fetchpriority=high, </app.js>; rel=modulepreload'
		);
		expect(await result.text()).toBe('<h1>Headline</h1>');
	});

	it.each(['application/json', 'text/markdown; charset=utf-8'])(
		'adds no font downloads to %s responses',
		async (contentType) => {
			const response = new Response('content', { headers: { 'content-type': contentType } });
			const result = await handleFontPreload({
				event: { route: { id: '/[[lang]]/(marketing)/pricing' } } as never,
				resolve: async () => response
			});
			expect(result.headers.has('link')).toBe(false);
		}
	);

	it('sends the homepage font in the head without starting the full font download', async () => {
		const result = await handleFontPreload({
			event: { route: { id: '/[[lang]]/(marketing)' } } as never,
			resolve: async (_event, options) => {
				const html =
					'<html><head><meta charset="utf-8" /><title>Home</title></head><body>Headline</body></html>';
				return new Response(await options?.transformPageChunk?.({ html, done: true }), {
					headers: { 'content-type': 'text/html', link: '</app.js>; rel=modulepreload' }
				});
			}
		});
		const html = await result.text();
		expect(html.slice(0, html.indexOf('</head>'))).toContain('data:font/woff2;base64,d09GMg');
		expect(html.slice(0, 1024)).toContain('<meta charset="utf-8" />');
		expect(html).toContain('<body>Headline</body>');
		expect(result.headers.get('link')).toBe('</app.js>; rel=modulepreload');
	});
});
