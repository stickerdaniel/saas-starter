import { describe, expect, it } from 'vitest';
import {
	PUBLIC_MARKETING_ROUTES,
	getLocalizedMarketingUrls,
	getMarketingMarkdownDocument,
	matchPublicMarketingRoute
} from './public-routes';
import { marketingMarkdown as aboutMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/about/page.md';
import { marketingMarkdown as brandMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/brand/page.md';
import { marketingMarkdown as brandMotionMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/brand/motion/page.md';
import { marketingMarkdown as brandResourcesMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/brand/resources/page.md';
import { marketingMarkdown as brandVisualIdentityMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/brand/visual-identity/page.md';
import { marketingMarkdown as brandVoiceAndToneMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/brand/voice-and-tone/page.md';
import { marketingMarkdown as homeMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/page.md';
import { marketingMarkdown as impressumMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/impressum/page.md';
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
			{ key: 'terms', pathSuffix: '/terms' },
			{ key: 'impressum', pathSuffix: '/impressum' },
			{ key: 'brand', pathSuffix: '/brand' },
			{ key: 'brand/visual-identity', pathSuffix: '/brand/visual-identity' },
			{ key: 'brand/voice-and-tone', pathSuffix: '/brand/voice-and-tone' },
			{ key: 'brand/motion', pathSuffix: '/brand/motion' },
			{ key: 'brand/resources', pathSuffix: '/brand/resources' }
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
		expect(matchPublicMarketingRoute('/fr/impressum')).toEqual({
			lang: 'fr',
			routeKey: 'impressum'
		});
		expect(matchPublicMarketingRoute('/en/brand')).toEqual({ lang: 'en', routeKey: 'brand' });
		expect(matchPublicMarketingRoute('/en/brand/visual-identity')).toEqual({
			lang: 'en',
			routeKey: 'brand/visual-identity'
		});
		expect(matchPublicMarketingRoute('/de/brand/voice-and-tone')).toEqual({
			lang: 'de',
			routeKey: 'brand/voice-and-tone'
		});
		expect(matchPublicMarketingRoute('/es/brand/motion')).toEqual({
			lang: 'es',
			routeKey: 'brand/motion'
		});
		expect(matchPublicMarketingRoute('/fr/brand/resources')).toEqual({
			lang: 'fr',
			routeKey: 'brand/resources'
		});
	});

	it('rejects non-marketing or non-localized paths', () => {
		expect(matchPublicMarketingRoute('/')).toBeNull();
		expect(matchPublicMarketingRoute('/api')).toBeNull();
		expect(matchPublicMarketingRoute('/llms.txt')).toBeNull();
		expect(matchPublicMarketingRoute('/en/app')).toBeNull();
		expect(matchPublicMarketingRoute('/en/admin')).toBeNull();
		expect(matchPublicMarketingRoute('/it')).toBeNull();
		expect(matchPublicMarketingRoute('/en/brand/unknown')).toBeNull();
	});

	it('returns the correct colocated markdown document for each route key', () => {
		expect(getMarketingMarkdownDocument('home')).toBe(homeMarketingMarkdown);
		expect(getMarketingMarkdownDocument('about')).toBe(aboutMarketingMarkdown);
		expect(getMarketingMarkdownDocument('pricing')).toBe(pricingMarketingMarkdown);
		expect(getMarketingMarkdownDocument('privacy')).toBe(privacyMarketingMarkdown);
		expect(getMarketingMarkdownDocument('terms')).toBe(termsMarketingMarkdown);
		expect(getMarketingMarkdownDocument('impressum')).toBe(impressumMarketingMarkdown);
		expect(getMarketingMarkdownDocument('brand')).toBe(brandMarketingMarkdown);
		expect(getMarketingMarkdownDocument('brand/visual-identity')).toBe(
			brandVisualIdentityMarketingMarkdown
		);
		expect(getMarketingMarkdownDocument('brand/voice-and-tone')).toBe(
			brandVoiceAndToneMarketingMarkdown
		);
		expect(getMarketingMarkdownDocument('brand/motion')).toBe(brandMotionMarketingMarkdown);
		expect(getMarketingMarkdownDocument('brand/resources')).toBe(brandResourcesMarketingMarkdown);
	});

	it('generates the expected localized public marketing URLs', () => {
		expect(getLocalizedMarketingUrls('https://example.com')).toEqual([
			'https://example.com/en',
			'https://example.com/en/about',
			'https://example.com/en/pricing',
			'https://example.com/en/privacy',
			'https://example.com/en/terms',
			'https://example.com/en/impressum',
			'https://example.com/en/brand',
			'https://example.com/en/brand/visual-identity',
			'https://example.com/en/brand/voice-and-tone',
			'https://example.com/en/brand/motion',
			'https://example.com/en/brand/resources',
			'https://example.com/de',
			'https://example.com/de/about',
			'https://example.com/de/pricing',
			'https://example.com/de/privacy',
			'https://example.com/de/terms',
			'https://example.com/de/impressum',
			'https://example.com/de/brand',
			'https://example.com/de/brand/visual-identity',
			'https://example.com/de/brand/voice-and-tone',
			'https://example.com/de/brand/motion',
			'https://example.com/de/brand/resources',
			'https://example.com/es',
			'https://example.com/es/about',
			'https://example.com/es/pricing',
			'https://example.com/es/privacy',
			'https://example.com/es/terms',
			'https://example.com/es/impressum',
			'https://example.com/es/brand',
			'https://example.com/es/brand/visual-identity',
			'https://example.com/es/brand/voice-and-tone',
			'https://example.com/es/brand/motion',
			'https://example.com/es/brand/resources',
			'https://example.com/fr',
			'https://example.com/fr/about',
			'https://example.com/fr/pricing',
			'https://example.com/fr/privacy',
			'https://example.com/fr/terms',
			'https://example.com/fr/impressum',
			'https://example.com/fr/brand',
			'https://example.com/fr/brand/visual-identity',
			'https://example.com/fr/brand/voice-and-tone',
			'https://example.com/fr/brand/motion',
			'https://example.com/fr/brand/resources'
		]);
	});
});
