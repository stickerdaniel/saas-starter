import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	authPageRedirect,
	resolveBarePathLanguage,
	shouldBypassLanguageRedirect,
	shouldRenderPublicMarkdownNotFound,
	temporaryRedirect,
	verificationFailureRedirect
} from './hooks.server';

describe('hooks.server', () => {
	it('creates application redirects as responses that outer hooks can decorate', () => {
		const response = temporaryRedirect('/en');
		expect(response.status).toBe(307);
		expect(response.headers.get('location')).toBe('/en');
	});

	it('wraps early Markdown responses with the security-header handle', () => {
		const source = fs.readFileSync(path.resolve('src/hooks.server.ts'), 'utf8');
		const sequence = source.slice(source.indexOf('export const handle = sequence('));
		expect(sequence.indexOf('handleSecurityHeaders')).toBeGreaterThanOrEqual(0);
		expect(sequence.indexOf('handleSecurityHeaders')).toBeLessThan(
			sequence.indexOf('handleMarketingMarkdown')
		);
	});

	it('bypasses localization redirects for root discovery files and api routes', () => {
		expect(shouldBypassLanguageRedirect('/llms.txt')).toBe(true);
		expect(shouldBypassLanguageRedirect('/llms.txt/')).toBe(true);
		expect(shouldBypassLanguageRedirect('/robots.txt')).toBe(true);
		expect(shouldBypassLanguageRedirect('/robots.txt/')).toBe(true);
		expect(shouldBypassLanguageRedirect('/sitemap.xml')).toBe(true);
		expect(shouldBypassLanguageRedirect('/sitemap.xml/')).toBe(true);
		expect(shouldBypassLanguageRedirect('/api/auth/session')).toBe(true);
		expect(shouldBypassLanguageRedirect('/en/pricing')).toBe(false);
	});
});

describe('shouldRenderPublicMarkdownNotFound', () => {
	const input = {
		method: 'GET',
		request: new Request('https://example.com/en/missing', {
			headers: { Accept: 'text/markdown' }
		}),
		status: 404,
		routeId: '/[[lang]]/[...path]',
		pathname: '/en/missing',
		lang: 'en'
	};

	it('matches only a localized public catch-all markdown 404', () => {
		expect(shouldRenderPublicMarkdownNotFound(input)).toBe(true);
		expect(shouldRenderPublicMarkdownNotFound({ ...input, method: 'HEAD' })).toBe(true);
	});

	it.each([
		{
			request: new Request('https://example.com/en/missing', { headers: { Accept: 'text/html' } })
		},
		{
			request: new Request('https://example.com/en/missing', {
				headers: { Accept: 'text/markdown;q=0' }
			})
		},
		{ method: 'POST' },
		{ status: 500 },
		{ routeId: '/[[lang]]/(marketing)/privacy' },
		{ pathname: '/en/app/missing' },
		{ pathname: '/en/admin/missing' },
		{ lang: 'it' }
	])('rejects a non-public or non-markdown case', (override) => {
		expect(shouldRenderPublicMarkdownNotFound({ ...input, ...override })).toBe(false);
	});
});

describe('resolveBarePathLanguage', () => {
	it('prefers a valid lang_pref cookie over Accept-Language', () => {
		expect(resolveBarePathLanguage('de', 'en-US,en;q=0.9')).toBe('de');
	});
	it('ignores an unsupported/tampered cookie and falls back to Accept-Language', () => {
		expect(resolveBarePathLanguage('xx', 'fr-FR,fr;q=0.9')).toBe('fr');
		expect(resolveBarePathLanguage('../../etc', 'es;q=0.8')).toBe('es');
	});
	it('uses the first supported Accept-Language tag when no cookie', () => {
		expect(resolveBarePathLanguage(undefined, 'de-DE,de;q=0.9,en;q=0.8')).toBe('de');
		expect(resolveBarePathLanguage(undefined, 'pt-BR,pt;q=0.9,es;q=0.8')).toBe('es');
	});
	it('defaults to en when neither cookie nor header yields a supported language', () => {
		expect(resolveBarePathLanguage(undefined, null)).toBe('en');
		expect(resolveBarePathLanguage(undefined, 'pt-BR,ja;q=0.8')).toBe('en');
	});
});

describe('verificationFailureRedirect', () => {
	// The four codes `redirectOnError` appends
	// (better-auth/dist/api/routes/email-verification.mjs). They arrive on
	// whatever page the link was minted with, which is why this sits in the
	// hook and not on a page.
	it.each(['TOKEN_EXPIRED', 'INVALID_TOKEN', 'USER_NOT_FOUND', 'INVALID_USER'])(
		'sends %s to sign-in with the destination intact',
		(code) => {
			expect(verificationFailureRedirect('/en/app/settings', `?error=${code}`, 'en')).toBe(
				`/en/signin?redirectTo=%2Fen%2Fapp%2Fsettings&error=${code}`
			);
		}
	);

	it('rescues a public destination, which no page would have reported', () => {
		// What the pricing table writes for a signed-out visitor clicking
		// checkout. Nothing on that page reads `error`, so before this the user
		// was told nothing at all.
		expect(
			verificationFailureRedirect('/en/pricing', '?checkout=pro&error=TOKEN_EXPIRED', 'en')
		).toBe('/en/signin?redirectTo=%2Fen%2Fpricing%3Fcheckout%3Dpro&error=TOKEN_EXPIRED');
	});

	it('unwraps the interstitial rather than carrying it forward', () => {
		// A signed-in visitor opening someone else's expired link bounces off
		// sign-in straight back to `redirectTo`. Carrying the interstitial there
		// put them on a page announcing a verification that had just failed.
		expect(
			verificationFailureRedirect(
				'/en/email-verified',
				'?redirectTo=%2Fen%2Fapp&error=TOKEN_EXPIRED',
				'en'
			)
		).toBe('/en/signin?redirectTo=%2Fen%2Fapp&error=TOKEN_EXPIRED');
	});

	it('falls back when the interstitial carries nothing usable', () => {
		expect(verificationFailureRedirect('/de/email-verified', '?error=INVALID_TOKEN', 'de')).toBe(
			'/de/signin?redirectTo=%2Fde%2Fapp&error=INVALID_TOKEN'
		);
		expect(
			verificationFailureRedirect(
				'/en/email-verified',
				'?redirectTo=%2F%2Fevil.com&error=INVALID_TOKEN',
				'en'
			)
		).toBe('/en/signin?redirectTo=%2Fen%2Fapp&error=INVALID_TOKEN');
	});

	it('unwraps an interstitial wrapping another one', () => {
		// Sign-up accepts any same-origin continuation, another interstitial
		// included, so one layer is not the limit and stopping there lands the
		// bounce on a page announcing the verification that just failed.
		expect(
			verificationFailureRedirect(
				'/en/email-verified',
				'?redirectTo=%2Fen%2Femail-verified%3FredirectTo%3D%252Fen%252Fapp%2Fsettings&error=INVALID_TOKEN',
				'en'
			)
		).toBe('/en/signin?redirectTo=%2Fen%2Fapp%2Fsettings&error=INVALID_TOKEN');
	});

	it('gives up on a chain deeper than any real link', () => {
		const nested = (depth: number): string =>
			depth === 0
				? '/en/app/settings'
				: `/en/email-verified?redirectTo=${encodeURIComponent(nested(depth - 1))}`;

		expect(
			verificationFailureRedirect(
				'/en/email-verified',
				`?redirectTo=${encodeURIComponent(nested(6))}&error=TOKEN_EXPIRED`,
				'en'
			)
		).toBe('/en/signin?redirectTo=%2Fen%2Fapp&error=TOKEN_EXPIRED');
	});

	it('leaves sign-in alone, which reads the code itself', () => {
		expect(verificationFailureRedirect('/en/signin', '?error=TOKEN_EXPIRED', 'en')).toBeNull();
	});

	it("ignores an application's own error parameter", () => {
		expect(verificationFailureRedirect('/en/app', '?error=checkout_failed', 'en')).toBeNull();
		expect(verificationFailureRedirect('/en/app', '', 'en')).toBeNull();
	});

	it('keeps the language of the page the link landed on', () => {
		expect(verificationFailureRedirect('/de/app', '?error=INVALID_TOKEN', 'de')).toBe(
			'/de/signin?redirectTo=%2Fde%2Fapp&error=INVALID_TOKEN'
		);
	});
});

describe('authPageRedirect', () => {
	it('sends a signed-in visitor to the destination they arrived with', () => {
		expect(authPageRedirect('?redirectTo=%2Fen%2Fapp%2Fsettings', 'en')).toBe('/en/app/settings');
	});

	it('falls back to the localized app when nothing usable came with them', () => {
		expect(authPageRedirect('', 'de')).toBe('/de/app');
		expect(authPageRedirect('?redirectTo=https%3A%2F%2Fevil.example', 'de')).toBe('/de/app');
	});

	/**
	 * The case round 13 found. An expired verification mail opened in a browser
	 * that already holds a session lands on sign-in through
	 * verificationFailureRedirect, and bouncing it onward would drop the only
	 * report of the failure that exists. The link cannot be retried into a
	 * better outcome, so the message is all the user can be given.
	 */
	it('leaves a signed-in visitor on the page that reports a failed link', () => {
		for (const code of ['TOKEN_EXPIRED', 'INVALID_TOKEN', 'USER_NOT_FOUND', 'INVALID_USER']) {
			expect(authPageRedirect(`?redirectTo=%2Fen%2Fapp&error=${code}`, 'en')).toBeNull();
		}
	});

	/**
	 * Better Auth appends its code after whatever the callback URL already
	 * carried, so a destination with an `error` of its own pushes the one that
	 * matters into second place. Reading only the first value bounced the visitor
	 * past the report.
	 */
	it('finds the code behind an error the destination brought itself', () => {
		expect(
			authPageRedirect('?redirectTo=%2Fen%2Fapp&error=checkout_failed&error=TOKEN_EXPIRED', 'en')
		).toBeNull();
	});

	it('still sends them on for an error the page reports without a link behind it', () => {
		expect(authPageRedirect('?redirectTo=%2Fen%2Fapp&error=account_not_linked', 'en')).toBe(
			'/en/app'
		);
	});

	/**
	 * A destination that is not a page of this application. Cloudflare answers a
	 * root asset from the asset store before the Worker runs, so a failure
	 * appended to one arrives as the file itself.
	 */
	it('refuses a destination outside the localized routes', () => {
		expect(authPageRedirect('?redirectTo=%2Ffavicon.ico', 'en')).toBe('/en/app');
		expect(authPageRedirect('?redirectTo=%2Frobots.txt', 'en')).toBe('/en/app');
	});
});
