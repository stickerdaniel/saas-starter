import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lex } from 'svelte-streamdown';
import { describe, expect, it } from 'vitest';
import { resolveLegalMarkdownLink, transformAllowedExternalUrl } from './legal-markdown-link';

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

async function installedTransformUrl(): Promise<
	(url: unknown, allowedPrefixes: string[], defaultOrigin?: string) => string | null
> {
	const entry = import.meta.resolve('svelte-streamdown');
	const moduleUrl = pathToFileURL(resolve(dirname(fileURLToPath(entry)), 'utils/url.js')).href;
	const module = await import(/* @vite-ignore */ moduleUrl);
	return module.transformUrl;
}

const localize = (path: string) => `/de${path}`;

describe('resolveLegalMarkdownLink', () => {
	it('localizes only parsed relative link tokens', () => {
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

		const links = linksIn(lex(markdown));
		expect(links.map(({ href, title }) => ({ href, title }))).toEqual([
			{ href: 'privacy', title: 'Read "the policy"' },
			{ href: 'terms', title: null },
			{ href: '#rights', title: null }
		]);
		expect(
			links.map((token) =>
				resolveLegalMarkdownLink(token.href, localize, ['*'], 'https://example.com')
			)
		).toEqual([
			{ href: '/de/privacy', external: false },
			{ href: '/de/terms', external: false },
			{ href: '#rights', external: false }
		]);
	});

	it('preserves root-relative links and blocks disallowed protocols', () => {
		expect(resolveLegalMarkdownLink('', localize, ['*'])).toBeNull();
		expect(resolveLegalMarkdownLink('/privacy', localize, ['*'])).toEqual({
			href: '/privacy',
			external: false
		});
		expect(resolveLegalMarkdownLink('javascript:alert(1)', localize, ['*'])).toBeNull();
	});

	it('matches the installed Streamdown allowlist contract for external URLs', async () => {
		const transformUrl = await installedTransformUrl();
		expect(transformUrl('privacy', ['*'], 'https://example.com')).not.toBeNull();
		expect(transformUrl('#rights', ['*'], 'https://example.com')).not.toBeNull();
		const cases: Array<[string, string[], string?]> = [
			['https://example.com/path', ['*']],
			['http://example.com/path', ['*']],
			['javascript:alert(1)', ['*']],
			['https://example.com/docs/page', ['https://example.com/docs']],
			['https://example.com/private', ['https://example.com/docs']],
			['mailto:privacy@example.com', ['mailto:']],
			['relative', ['*'], 'https://example.com']
		];

		for (const [href, prefixes, origin] of cases) {
			expect(transformAllowedExternalUrl(href, prefixes, origin)).toBe(
				transformUrl(href, prefixes, origin)
			);
		}
	});
});
