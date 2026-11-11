import { describe, expect, it } from 'vitest';
import {
	getDefaultLanguageMarketingUrl,
	getLocalizedMarketingUrls,
	matchPublicMarketingRoute
} from './public-routes';

describe('public marketing route registry', () => {
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
		expect(matchPublicMarketingRoute('/fr/impressum')).toEqual({
			lang: 'fr',
			routeKey: 'impressum'
		});
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
			'https://example.com/en/impressum',
			'https://example.com/de',
			'https://example.com/de/pricing',
			'https://example.com/de/about',
			'https://example.com/de/contact',
			'https://example.com/de/privacy',
			'https://example.com/de/terms',
			'https://example.com/de/impressum',
			'https://example.com/es',
			'https://example.com/es/pricing',
			'https://example.com/es/about',
			'https://example.com/es/contact',
			'https://example.com/es/privacy',
			'https://example.com/es/terms',
			'https://example.com/es/impressum',
			'https://example.com/fr',
			'https://example.com/fr/pricing',
			'https://example.com/fr/about',
			'https://example.com/fr/contact',
			'https://example.com/fr/privacy',
			'https://example.com/fr/terms',
			'https://example.com/fr/impressum'
		]);
	});
});
