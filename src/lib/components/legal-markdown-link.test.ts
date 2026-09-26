import { describe, expect, it } from 'vitest';
import { resolveLegalMarkdownLink } from './legal-markdown-link';

const localize = (path: string) => `/de${path}`;
const currentUrl = new URL('https://example.com/de/terms');

describe('resolveLegalMarkdownLink', () => {
	it('resolves query and parent-relative links within the current language', () => {
		expect(resolveLegalMarkdownLink('?print=1', null, currentUrl, localize)).toEqual({
			href: '/de/terms?print=1',
			external: false
		});
		expect(resolveLegalMarkdownLink('../privacy', null, currentUrl, localize)).toEqual({
			href: '/de/privacy',
			external: false
		});
		expect(resolveLegalMarkdownLink('privacy/', null, currentUrl, localize)).toEqual({
			href: '/de/privacy/',
			external: false
		});
	});

	it('uses Streamdown-sanitized external targets', () => {
		expect(
			resolveLegalMarkdownLink(
				'https://example.com/docs',
				'https://example.com/docs',
				currentUrl,
				localize
			)
		).toEqual({ href: 'https://example.com/docs', external: true });
		expect(resolveLegalMarkdownLink('javascript:alert(1)', null, currentUrl, localize)).toBeNull();
	});

	it('preserves empty, root-relative, and anchor targets', () => {
		expect(resolveLegalMarkdownLink('', null, currentUrl, localize)).toBeNull();
		expect(
			resolveLegalMarkdownLink('//evil.example/privacy', '/privacy', currentUrl, localize)
		).toBeNull();
		expect(resolveLegalMarkdownLink('/privacy', '/privacy', currentUrl, localize)).toEqual({
			href: '/privacy',
			external: false
		});
		expect(
			resolveLegalMarkdownLink(String.raw`/\evil.example/privacy`, '/privacy', currentUrl, localize)
		).toEqual({ href: '/privacy', external: false });
		expect(resolveLegalMarkdownLink('#rights', null, currentUrl, localize)).toEqual({
			href: '#rights',
			external: false
		});
	});
});
