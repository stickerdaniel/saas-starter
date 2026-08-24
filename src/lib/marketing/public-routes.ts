import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, isSupportedLanguage } from '$lib/i18n/languages';
import { LEGAL_CONTENT_DATES } from '$lib/content/legal-metadata';
import { marketingMarkdown as homeMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/page.md';
import { marketingMarkdown as impressumMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/impressum/page.md';
import { marketingMarkdown as pricingMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/pricing/page.md';
import { marketingMarkdown as privacyMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/privacy/page.md';
import { marketingMarkdown as termsMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/terms/page.md';

export type PublicMarketingRouteKey = 'home' | 'pricing' | 'privacy' | 'terms' | 'impressum';
export type PublicMarketingPathSuffix = '' | '/pricing' | '/privacy' | '/terms' | '/impressum';

export interface PublicMarketingRouteDefinition {
	key: PublicMarketingRouteKey;
	pathSuffix: PublicMarketingPathSuffix;
	agentLabel: string;
	agentDescription: string;
	lastModified?: string;
}

export interface MatchedPublicMarketingRoute {
	lang: string;
	routeKey: PublicMarketingRouteKey;
}

export const PUBLIC_MARKETING_ROUTES: PublicMarketingRouteDefinition[] = [
	{
		key: 'home',
		pathSuffix: '',
		agentLabel: 'Home',
		agentDescription: 'product overview, positioning, and core integrations'
	},
	{
		key: 'pricing',
		pathSuffix: '/pricing',
		agentLabel: 'Pricing',
		agentDescription: 'pricing tiers, included features, and billing notes'
	},
	{
		key: 'privacy',
		pathSuffix: '/privacy',
		agentLabel: 'Privacy Policy',
		agentDescription: 'how personal data is collected, used, and protected',
		lastModified: LEGAL_CONTENT_DATES.privacy
	},
	{
		key: 'terms',
		pathSuffix: '/terms',
		agentLabel: 'Terms of Service',
		agentDescription: 'terms and conditions for using the service',
		lastModified: LEGAL_CONTENT_DATES.terms
	},
	{
		key: 'impressum',
		pathSuffix: '/impressum',
		agentLabel: 'Impressum',
		agentDescription: 'provider identification and contact details',
		lastModified: LEGAL_CONTENT_DATES.impressum
	}
];

const MARKETING_DOCUMENTS = {
	home: homeMarketingMarkdown,
	pricing: pricingMarketingMarkdown,
	privacy: privacyMarketingMarkdown,
	terms: termsMarketingMarkdown,
	impressum: impressumMarketingMarkdown
} as const;

export function matchPublicMarketingRoute(pathname: string): MatchedPublicMarketingRoute | null {
	const normalizedPath = pathname !== '/' ? pathname.replace(/\/+$/, '') : pathname;
	const match = normalizedPath.match(/^\/([a-z]{2})(?:\/(pricing|privacy|terms|impressum))?$/);

	if (!match) return null;

	const [, lang, section] = match;
	if (!isSupportedLanguage(lang)) return null;

	return {
		lang,
		routeKey: (section ?? 'home') as PublicMarketingRouteKey
	};
}

export function getMarketingMarkdownDocument(routeKey: PublicMarketingRouteKey) {
	return MARKETING_DOCUMENTS[routeKey];
}

export function getLocalizedMarketingUrl(
	origin: string,
	languageCode: string,
	pathSuffix: PublicMarketingPathSuffix
): string {
	const baseOrigin = origin.replace(/\/$/, '');
	return pathSuffix
		? `${baseOrigin}/${languageCode}${pathSuffix}`
		: `${baseOrigin}/${languageCode}`;
}

export function getDefaultLanguageMarketingUrl(
	origin: string,
	pathSuffix: PublicMarketingPathSuffix
): string {
	return getLocalizedMarketingUrl(origin, DEFAULT_LANGUAGE, pathSuffix);
}

export function getLocalizedMarketingUrls(origin: string): string[] {
	return SUPPORTED_LANGUAGES.flatMap((language) =>
		PUBLIC_MARKETING_ROUTES.map(({ pathSuffix }) =>
			getLocalizedMarketingUrl(origin, language.code, pathSuffix)
		)
	);
}
