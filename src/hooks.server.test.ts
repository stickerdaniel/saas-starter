import { describe, expect, it } from 'vitest';
import { resolveBarePathLanguage, shouldBypassLanguageRedirect } from './hooks.server';

describe('hooks.server', () => {
	it('bypasses localization redirects for root discovery files and api routes', () => {
		expect(shouldBypassLanguageRedirect('/llms.txt')).toBe(true);
		expect(shouldBypassLanguageRedirect('/llms.txt/')).toBe(true);
		expect(shouldBypassLanguageRedirect('/robots.txt')).toBe(true);
		expect(shouldBypassLanguageRedirect('/robots.txt/')).toBe(true);
		expect(shouldBypassLanguageRedirect('/sitemap.xml')).toBe(true);
		expect(shouldBypassLanguageRedirect('/sitemap.xml/')).toBe(true);
		expect(shouldBypassLanguageRedirect('/api/auth/session')).toBe(true);
		expect(shouldBypassLanguageRedirect('/en/about')).toBe(false);
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
