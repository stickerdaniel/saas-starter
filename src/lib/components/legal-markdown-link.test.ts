import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lex } from 'svelte-streamdown';
import { describe, expect, it } from 'vitest';
import { LEGAL_LINK_PREFIXES, resolveLegalMarkdownLink } from './legal-markdown-link';

interface LinkToken {
	type: 'link';
	href: string;
	title?: string | null;
}

function linksIn(value: unknown): LinkToken[] {
	if (Array.isArray(value)) return value.flatMap(linksIn);
	if (!value || typeof value !== 'object') return [];
	const record = value as Record<string, unknown>;
	const current = record.type === 'link' ? [record as unknown as LinkToken] : [];
	return [...current, ...Object.values(record).flatMap(linksIn)];
}

function installedPackageDirectory(): string {
	return dirname(fileURLToPath(import.meta.resolve('svelte-streamdown')));
}

async function installedTransformUrl(): Promise<
	(url: unknown, allowedPrefixes: string[], defaultOrigin?: string) => string | null
> {
	const moduleUrl = pathToFileURL(resolve(installedPackageDirectory(), 'utils/url.js')).href;
	const module = await import(/* @vite-ignore */ moduleUrl);
	return module.transformUrl;
}

const localize = (path: string) => `/de${path}`;
const currentUrl = new URL('https://example.com/de/terms');

describe('resolveLegalMarkdownLink', () => {
	it('localizes only parsed relative link tokens', async () => {
		const markdown = [
			'[Inline](privacy "Read \\"the policy\\"")',
			'[Reference][policy]',
			'[Anchor](#rights)',
			'`[Inline code](privacy)`',
			'',
			'```md',
			'[Fenced code](privacy)',
			'```',
			'',
			'A statement.[^1]',
			'',
			'[policy]: terms',
			'[^1]: Supporting text.'
		].join('\n');

		const transformUrl = await installedTransformUrl();
		const links = linksIn(lex(markdown));
		expect(links.map(({ href, title }) => ({ href, title }))).toEqual([
			{ href: 'privacy', title: 'Read "the policy"' },
			{ href: 'terms', title: null },
			{ href: '#rights', title: null }
		]);
		expect(
			links.map((token) =>
				resolveLegalMarkdownLink(
					token.href,
					transformUrl(token.href, LEGAL_LINK_PREFIXES, currentUrl.origin),
					currentUrl,
					localize
				)
			)
		).toEqual([
			{ href: '/de/privacy', external: false },
			{ href: '/de/terms', external: false },
			{ href: '#rights', external: false }
		]);
	});

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

	it('pins the sanitized href supplied to the custom link snippet', () => {
		const source = readFileSync(
			resolve(installedPackageDirectory(), 'Elements/Link.svelte'),
			'utf8'
		);
		expect(source).toMatch(/props=\{\{[\s\S]*?href:\s*transformedUrl,[\s\S]*?token[\s\S]*?\}\}/);
		expect(source).toContain('render={streamdown.snippets.link}');
		expect(source).toContain(
			"{#if transformedUrl || token.href === 'streamdown:incomplete-link' || isRelativeUrl}"
		);
	});

	it('pins Streamdown routing of relative and anchor tokens into the custom snippet', async () => {
		const transformUrl = await installedTransformUrl();
		expect(transformUrl('privacy', LEGAL_LINK_PREFIXES, currentUrl.origin)).not.toBeNull();
		expect(transformUrl('#rights', LEGAL_LINK_PREFIXES, currentUrl.origin)).not.toBeNull();
	});
});
