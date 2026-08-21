import { describe, expect, it } from 'vitest';
import {
	resolveBarePathLanguage,
	shouldBypassLanguageRedirect,
	verificationFailureRedirect
} from './hooks.server';

describe('hooks.server', () => {
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
