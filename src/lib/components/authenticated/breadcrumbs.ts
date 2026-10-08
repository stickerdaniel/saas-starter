import { SEARCH_ROUTES } from '#lib/components/global-search/search-routes.js';
import { getLanguage } from '#lib/i18n/languages.js';
import { localizedHref } from '#lib/utils/i18n.js';

export interface BreadcrumbItem {
	label: string;
	href: string;
	isLast: boolean;
}

// Known pages reuse the translated titles of the global search registry, keyed
// by their full unprefixed path so /app/settings and /admin/settings stay distinct.
const ROUTE_TITLE_KEYS = new Map(
	SEARCH_ROUTES.flatMap((route) => (route.titleKey ? [[route.href, route.titleKey] as const] : []))
);

function routeLabel(path: string, segment: string, translate: (key: string) => string): string {
	const key = ROUTE_TITLE_KEYS.get(path);
	const translated = key ? translate(key) : '';
	// A missing translation comes back as the key itself; never show it.
	return translated && translated !== key ? translated : formatSegment(segment);
}

function formatSegment(segment: string): string {
	return segment
		.split('-')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

export function buildBreadcrumbs(
	pathname: string,
	routePrefix: string,
	rootLabel: string,
	lang: string | undefined,
	translate: (key: string) => string
): BreadcrumbItem[] {
	const segments = pathname.split('/').filter(Boolean);
	if (segments.length === 0) return [];

	// Match the existing heuristic: treat any 2-char first segment as a language prefix.
	// SvelteKit's [[lang]] matcher upstream restricts this to supported codes in practice.
	const first = segments[0]!;
	const prefixSegmentIndex = first.length === 2 && segments.length > 1 ? 1 : 0;

	if (segments[prefixSegmentIndex] !== routePrefix) return [];

	const currentLang = getLanguage(lang).code;
	const lastIndex = segments.length - 1;

	const items: BreadcrumbItem[] = [
		{
			label: rootLabel,
			href: localizedHref(`/${routePrefix}`, currentLang),
			isLast: prefixSegmentIndex === lastIndex
		}
	];

	for (let i = prefixSegmentIndex + 1; i <= lastIndex; i += 1) {
		const cumulativePath = `/${segments.slice(prefixSegmentIndex, i + 1).join('/')}`;
		items.push({
			label: routeLabel(cumulativePath, segments[i]!, translate),
			href: localizedHref(cumulativePath, currentLang),
			isLast: i === lastIndex
		});
	}

	return items;
}
