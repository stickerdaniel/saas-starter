import { SUPPORTED_LANGUAGES, isSupportedLanguage } from '$lib/i18n/languages';
import { marketingMarkdown as homeMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/page.md';
import { marketingMarkdown as impressumMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/impressum/page.md';
import { marketingMarkdown as pricingMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/pricing/page.md';
import { marketingMarkdown as privacyMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/privacy/page.md';
import { marketingMarkdown as termsMarketingMarkdown } from '../../routes/[[lang]]/(marketing)/terms/page.md';

export type PublicMarketingRouteKey = 'home' | 'pricing' | 'privacy' | 'terms' | 'impressum';

export interface PublicMarketingRouteDefinition {
	key: PublicMarketingRouteKey;
	pathSuffix: '' | '/pricing' | '/privacy' | '/terms' | '/impressum';
}

export interface MatchedPublicMarketingRoute {
	lang: string;
	routeKey: PublicMarketingRouteKey;
}

export const PUBLIC_MARKETING_ROUTES: PublicMarketingRouteDefinition[] = [
	{ key: 'home', pathSuffix: '' },
	{ key: 'pricing', pathSuffix: '/pricing' },
	{ key: 'privacy', pathSuffix: '/privacy' },
	{ key: 'terms', pathSuffix: '/terms' },
	{ key: 'impressum', pathSuffix: '/impressum' }
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

	if (!match) {
		return null;
	}

	const [, lang, section] = match;
	if (!isSupportedLanguage(lang)) {
		return null;
	}

	return {
		lang,
		routeKey: (section ?? 'home') as PublicMarketingRouteKey
	};
}

export function getMarketingMarkdownDocument(routeKey: PublicMarketingRouteKey) {
	return MARKETING_DOCUMENTS[routeKey];
}

export function getLocalizedMarketingUrls(origin: string): string[] {
	const baseOrigin = origin.replace(/\/$/, '');

	return SUPPORTED_LANGUAGES.flatMap((language) =>
		PUBLIC_MARKETING_ROUTES.map(({ pathSuffix }) =>
			pathSuffix ? `${baseOrigin}/${language.code}${pathSuffix}` : `${baseOrigin}/${language.code}`
		)
	);
}
