import { SUPPORTED_LANGUAGES } from '$lib/i18n/languages';

/**
 * Every page route, as a path without its locale prefix. Paths that match none of
 * these are reported as `/404`, so text someone typed into a URL (the catch-all
 * route renders anything) never reaches analytics.
 *
 * `routes.test.ts` fails when a `+page.svelte` is added or removed without updating
 * this list. A route with a `[param]` segment is reported with the placeholder, not
 * the value; if a param holds personal data, that is the behaviour you want.
 */
export const ANALYTICS_ROUTES = [
	'/',
	'/email-verified',
	'/forgot-password',
	'/passkey-setup',
	'/reset-password',
	'/signin',
	'/signup',
	'/impressum',
	'/licenses',
	'/pricing',
	'/privacy',
	'/terms',
	'/admin',
	'/admin/audit-log',
	'/admin/dashboard',
	'/admin/settings',
	'/admin/support',
	'/admin/users',
	'/app',
	'/app/ai-chat',
	'/app/community-chat',
	'/app/settings',
	'/shadcn-demo'
] as const;

export const NOT_FOUND_PATH = '/404';

const LANGUAGE_CODES = new Set<string>(SUPPORTED_LANGUAGES.map((language) => language.code));
const TEMPLATES = ANALYTICS_ROUTES.map((route) => route.split('/').filter(Boolean));

function matchTemplate(segments: string[]): string[] | undefined {
	for (const template of TEMPLATES) {
		if (template.length !== segments.length) continue;
		const matches = template.every(
			(part, index) => part === segments[index] || /^\[[^\]]+\]$/.test(part)
		);
		if (matches) return template;
	}
	return undefined;
}

/** The path to report for a raw pathname: a known route (placeholders for params) or `/404`. */
export function reportedPath(pathname: string): string {
	const segments = pathname.split('/').filter(Boolean);
	const [first] = segments;
	const locale = first && LANGUAGE_CODES.has(first) ? first : undefined;
	const rest = locale ? segments.slice(1) : segments;
	const template = matchTemplate(rest);
	if (!template) return NOT_FOUND_PATH;
	const path = [...(locale ? [locale] : []), ...template].join('/');
	return `/${path}`;
}
