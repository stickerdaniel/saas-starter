import { describe, expect, it } from 'vitest';
import { LEGAL_CONTENT_DATES } from '#lib/content/legal-metadata.js';
import {
	PUBLIC_MARKETING_ROUTES,
	getDefaultLanguageMarketingUrl,
	getLocalizedMarketingUrls,
	getMarketingMarkdownDocument,
	matchPublicMarketingRoute
} from './public-routes';
import { marketingMarkdown as homeMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/page.md';
import { marketingMarkdown as aboutMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/about/page.md';
import { marketingMarkdown as contactMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/contact/page.md';
import { marketingMarkdown as pricingMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/pricing/page.md';
import { marketingMarkdown as privacyMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/privacy/page.md';
import { marketingMarkdown as termsMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/terms/page.md';

describe('public marketing route registry', () => {
	it('defines the canonical public marketing routes and authored dates', () => {
		expect(PUBLIC_MARKETING_ROUTES.map(({ key, pathSuffix }) => ({ key, pathSuffix }))).toEqual([
			{ key: 'home', pathSuffix: '' },
			{ key: 'pricing', pathSuffix: '/pricing' },
			{ key: 'about', pathSuffix: '/about' },
			{ key: 'contact', pathSuffix: '/contact' },
			{ key: 'privacy', pathSuffix: '/privacy' },
			{ key: 'terms', pathSuffix: '/terms' }
		]);
		expect(
			Object.fromEntries(
				PUBLIC_MARKETING_ROUTES.map(({ key, lastModified }) => [key, lastModified])
			)
		).toEqual({
			home: undefined,
			pricing: undefined,
			about: undefined,
			contact: undefined,
			// Setup moves the authored dates to the setup day, so read them from their source.
			privacy: LEGAL_CONTENT_DATES.privacy,
			terms: LEGAL_CONTENT_DATES.terms
		});
		expect(
			PUBLIC_MARKETING_ROUTES.every((route) => route.agentLabel && route.agentDescription)
		).toBe(true);
	});

	it('matches localized marketing paths to route keys', () => {
		expect(matchPublicMarketingRoute('/en')).toEqual({ lang: 'en', routeKey: 'home' });
		expect(matchPublicMarketingRoute('/de')).toEqual({ lang: 'de', routeKey: 'home' });
		expect(matchPublicMarketingRoute('/fr/pricing')).toEqual({ lang: 'fr', routeKey: 'pricing' });
		expect(matchPublicMarketingRoute('/fr/pricing/')).toEqual({
			lang: 'fr',
			routeKey: 'pricing'
		});
		expect(matchPublicMarketingRoute('/en/privacy')).toEqual({
			lang: 'en',
			routeKey: 'privacy'
		});
		expect(matchPublicMarketingRoute('/de/terms')).toEqual({ lang: 'de', routeKey: 'terms' });
		expect(matchPublicMarketingRoute('/en/about')).toEqual({ lang: 'en', routeKey: 'about' });
		expect(matchPublicMarketingRoute('/de/about/')).toEqual({ lang: 'de', routeKey: 'about' });
		expect(matchPublicMarketingRoute('/es/contact')).toEqual({ lang: 'es', routeKey: 'contact' });
		expect(matchPublicMarketingRoute('/en/contact/')).toEqual({
			lang: 'en',
			routeKey: 'contact'
		});
	});

	it('rejects non-marketing or non-localized paths', () => {
		expect(matchPublicMarketingRoute('/')).toBeNull();
		expect(matchPublicMarketingRoute('/api')).toBeNull();
		expect(matchPublicMarketingRoute('/llms.txt')).toBeNull();
		expect(matchPublicMarketingRoute('/en/app')).toBeNull();
		expect(matchPublicMarketingRoute('/en/admin')).toBeNull();
		expect(matchPublicMarketingRoute('/it')).toBeNull();
		expect(matchPublicMarketingRoute('/about')).toBeNull();
		expect(matchPublicMarketingRoute('/it/about')).toBeNull();
		expect(matchPublicMarketingRoute('/en/about/extra')).toBeNull();
		expect(matchPublicMarketingRoute('/en/contact/extra')).toBeNull();
		expect(matchPublicMarketingRoute('/en/contactus')).toBeNull();
		// The legal notice moved into Contact; its old path only redirects there.
		expect(matchPublicMarketingRoute('/en/impressum')).toBeNull();
	});

	it('returns the correct colocated markdown document for each route key', () => {
		expect(getMarketingMarkdownDocument('home')).toBe(homeMarketingMarkdown);
		expect(getMarketingMarkdownDocument('pricing')).toBe(pricingMarketingMarkdown);
		expect(getMarketingMarkdownDocument('about')).toBe(aboutMarketingMarkdown);
		expect(getMarketingMarkdownDocument('contact')).toBe(contactMarketingMarkdown);
		expect(getMarketingMarkdownDocument('privacy')).toBe(privacyMarketingMarkdown);
		expect(getMarketingMarkdownDocument('terms')).toBe(termsMarketingMarkdown);
	});

	it('generates a direct default-language URL', () => {
		expect(getDefaultLanguageMarketingUrl('https://example.com/', '/privacy')).toBe(
			'https://example.com/en/privacy'
		);
	});

	it('generates the expected localized public marketing URLs', () => {
		expect(getLocalizedMarketingUrls('https://example.com')).toEqual([
			'https://example.com/en',
			'https://example.com/en/pricing',
			'https://example.com/en/about',
			'https://example.com/en/contact',
			'https://example.com/en/privacy',
			'https://example.com/en/terms',
			'https://example.com/de',
			'https://example.com/de/pricing',
			'https://example.com/de/about',
			'https://example.com/de/contact',
			'https://example.com/de/privacy',
			'https://example.com/de/terms',
			'https://example.com/es',
			'https://example.com/es/pricing',
			'https://example.com/es/about',
			'https://example.com/es/contact',
			'https://example.com/es/privacy',
			'https://example.com/es/terms',
			'https://example.com/fr',
			'https://example.com/fr/pricing',
			'https://example.com/fr/about',
			'https://example.com/fr/contact',
			'https://example.com/fr/privacy',
			'https://example.com/fr/terms'
		]);
	});
});
