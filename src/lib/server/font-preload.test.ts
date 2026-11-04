import { describe, expect, it, vi } from 'vitest';

vi.mock('virtual:marketing-fonts/server', () => {
	const href = `data:font/woff2;base64,d09GMg${'A'.repeat(2048)}==`;
	const font = { css: `@font-face{font-family:Critical;src:url(${href})}`, href };
	return { default: { home: font, public: font } };
});

import { handleFontPreload } from './font-preload';

describe('HTML font preloads', () => {
	it("advertises the head's font preloads once without replacing existing resource hints or the body", async () => {
		const font = '<link rel="preload" as="font" href="/_fonts/outfit.woff2" crossorigin="">';
		const html = `<html><head>${font}${font}<link rel="preload" as="image" href="/hero.png"></head><body><h1>Headline</h1></body></html>`;
		const result = await handleFontPreload({
			event: { route: { id: '/[[lang]]/(app)/dashboard' } } as never,
			resolve: async (_event, options) =>
				new Response(await options?.transformPageChunk?.({ html, done: true }), {
					headers: {
						'content-type': 'text/html; charset=utf-8',
						link: '</app.js>; rel=modulepreload'
					}
				})
		});
		expect(result.headers.get('link')).toBe(
			'</_fonts/outfit.woff2>; rel=preload; as=font; crossorigin; fetchpriority=high, </app.js>; rel=modulepreload'
		);
		expect(await result.text()).toBe(html);
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

	it.each(['/[[lang]]/(marketing)/pricing', '/[[lang]]/(auth)/signin'])(
		'decodes the font before layout and preserves form script hints on %s',
		async (route) => {
			const fullFace = '<style>@font-face{font-family:Outfit;src:url(/full.woff2)}</style>';
			const result = await handleFontPreload({
				event: { route: { id: route } } as never,
				resolve: async (_event, options) => {
					const html = `<html><head><meta charset="utf-8" />${fullFace}</head><body>Public copy</body></html>`;
					const links = [
						{ type: 'css', path: '/app.css', link: '</app.css>; rel=preload; as=style' },
						{ type: 'js', path: '/app.js', link: '</app.js>; rel=modulepreload' }
					] as const;
					const hints = links
						.filter((link) => options?.preload?.(link) ?? true)
						.map((link) => link.link)
						.join(', ');
					return new Response(await options?.transformPageChunk?.({ html, done: true }), {
						headers: {
							'content-type': 'text/html',
							link: hints
						}
					});
				}
			});
			const html = await result.text();
			expect(html).toContain(
				'<link rel="preload" as="font" type="font/woff2" href="data:font/woff2;base64,d09GMg'
			);
			expect(html.indexOf('data:font')).toBeLessThan(html.indexOf(fullFace));
			expect(html.lastIndexOf('data:font')).toBeGreaterThan(html.indexOf(fullFace));
			expect(html.slice(0, 1024)).toContain('<meta charset="utf-8" />');
			expect(html).toContain('<body>Public copy</body>');
			expect(result.headers.get('link')).toBe('</app.css>; rel=preload; as=style');
			if (route.includes('(auth)')) {
				expect(html).toContain('<link rel="modulepreload" href="/app.js" fetchpriority="low">');
			} else {
				expect(html).not.toContain('modulepreload');
			}
		}
	);
});
