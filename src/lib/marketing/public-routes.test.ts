import { describe, expect, it } from 'vitest';
import {
	PUBLIC_MARKETING_ROUTES,
	getLocalizedMarketingUrls,
	getMarketingMarkdownDocument,
	matchPublicMarketingRoute
} from './public-routes';
import { marketingMarkdown as aboutMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/about/page.md';
import { marketingMarkdown as homeMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/page.md';
import { marketingMarkdown as pricingMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/pricing/page.md';
import { marketingMarkdown as privacyMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/privacy/page.md';
import { marketingMarkdown as termsMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/terms/page.md';

describe('public marketing route registry', () => {
	it('defines the canonical public marketing routes', () => {
		expect(PUBLIC_MARKETING_ROUTES).toEqual([
			{ key: 'home', pathSuffix: '' },
			{ key: 'about', pathSuffix: '/about' },
			{ key: 'pricing', pathSuffix: '/pricing' },
			{ key: 'privacy', pathSuffix: '/privacy' },
			{ key: 'terms', pathSuffix: '/terms' }
		]);
	});

	it('matches localized marketing paths to route keys', () => {
		expect(matchPublicMarketingRoute('/en')).toEqual({ lang: 'en', routeKey: 'home' });
		expect(matchPublicMarketingRoute('/de')).toEqual({ lang: 'de', routeKey: 'home' });
		expect(matchPublicMarketingRoute('/es/about')).toEqual({ lang: 'es', routeKey: 'about' });
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
	});

	it('rejects non-marketing or non-localized paths', () => {
		expect(matchPublicMarketingRoute('/')).toBeNull();
		expect(matchPublicMarketingRoute('/api')).toBeNull();
		expect(matchPublicMarketingRoute('/llms.txt')).toBeNull();
		expect(matchPublicMarketingRoute('/en/app')).toBeNull();
		expect(matchPublicMarketingRoute('/en/admin')).toBeNull();
		expect(matchPublicMarketingRoute('/it')).toBeNull();
	});

	it('returns the correct colocated markdown document for each route key', () => {
		expect(getMarketingMarkdownDocument('home')).toBe(homeMarketingMarkdown);
		expect(getMarketingMarkdownDocument('about')).toBe(aboutMarketingMarkdown);
		expect(getMarketingMarkdownDocument('pricing')).toBe(pricingMarketingMarkdown);
		expect(getMarketingMarkdownDocument('privacy')).toBe(privacyMarketingMarkdown);
		expect(getMarketingMarkdownDocument('terms')).toBe(termsMarketingMarkdown);
	});

	it('generates the expected localized public marketing URLs', () => {
		expect(getLocalizedMarketingUrls('https://example.com')).toEqual([
			'https://example.com/en',
			'https://example.com/en/about',
			'https://example.com/en/pricing',
			'https://example.com/en/privacy',
			'https://example.com/en/terms',
			'https://example.com/de',
			'https://example.com/de/about',
			'https://example.com/de/pricing',
			'https://example.com/de/privacy',
			'https://example.com/de/terms',
			'https://example.com/es',
			'https://example.com/es/about',
			'https://example.com/es/pricing',
			'https://example.com/es/privacy',
			'https://example.com/es/terms',
			'https://example.com/fr',
			'https://example.com/fr/about',
			'https://example.com/fr/pricing',
			'https://example.com/fr/privacy',
			'https://example.com/fr/terms'
		]);
	});
});
