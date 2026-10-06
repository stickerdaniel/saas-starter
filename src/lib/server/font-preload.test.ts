import { describe, expect, it, vi } from 'vitest';

vi.mock('fontless/runtime', () => ({
	preloads: [{ href: '/_fonts/outfit.woff2' }, { href: '/_fonts/outfit.woff2' }]
}));

import { handleFontPreload } from './font-preload';

describe('HTML font preloads', () => {
	it('advertises the font once without replacing existing resource hints or the body', async () => {
		const response = new Response('<h1>Headline</h1>', {
			headers: {
				'content-type': 'text/html; charset=utf-8',
				link: '</app.js>; rel=modulepreload'
			}
		});
		const result = await handleFontPreload({ event: {} as never, resolve: async () => response });
		expect(result.headers.get('link')).toBe(
			'</_fonts/outfit.woff2>; rel=preload; as=font; crossorigin; fetchpriority=high, </app.js>; rel=modulepreload'
		);
		expect(await result.text()).toBe('<h1>Headline</h1>');
	});

	it.each(['application/json', 'text/markdown; charset=utf-8'])(
		'adds no font downloads to %s responses',
		async (contentType) => {
			const response = new Response('content', { headers: { 'content-type': contentType } });
			const result = await handleFontPreload({ event: {} as never, resolve: async () => response });
			expect(result.headers.has('link')).toBe(false);
		}
	);
});
