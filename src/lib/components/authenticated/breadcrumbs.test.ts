import { describe, expect, it } from 'vitest';
import de from '../../../i18n/de.json';
import en from '../../../i18n/en.json';
import fr from '../../../i18n/fr.json';
import { buildBreadcrumbs } from './breadcrumbs';

// Resolves a dotted key against a locale file and, like Tolgee, falls back to the key.
function translatorFor(locale: object) {
	return (key: string): string => {
		const value = key
			.split('.')
			.reduce<unknown>(
				(node, part) =>
					node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
				locale
			);
		return typeof value === 'string' ? value : key;
	};
}

const tEn = translatorFor(en);
const tDe = translatorFor(de);
const tFr = translatorFor(fr);

const labels = (items: ReturnType<typeof buildBreadcrumbs>) => items.map((item) => item.label);

describe('buildBreadcrumbs', () => {
	it('returns the root crumb only for the bare prefix with a language segment', () => {
		expect(buildBreadcrumbs('/en/app', 'app', 'App', 'en', tEn)).toEqual([
			{ label: 'App', href: '/en/app', isLast: true }
		]);
	});

	it('returns the root crumb only for the bare prefix without a language segment', () => {
		expect(buildBreadcrumbs('/app', 'app', 'App', 'en', tEn)).toEqual([
			{ label: 'App', href: '/en/app', isLast: true }
		]);
	});

	it('labels a known app page with its translated title', () => {
		expect(buildBreadcrumbs('/de/app/settings', 'app', 'App', 'de', tDe)).toEqual([
			{ label: 'App', href: '/de/app', isLast: false },
			{ label: 'Einstellungen', href: '/de/app/settings', isLast: true }
		]);
	});

	it('labels every known app page in the active language', () => {
		expect(labels(buildBreadcrumbs('/de/app/community-chat', 'app', 'App', 'de', tDe))).toEqual([
			'App',
			'Community-Chat'
		]);
		expect(labels(buildBreadcrumbs('/de/app/ai-chat', 'app', 'App', 'de', tDe))).toEqual([
			'App',
			'KI-Chat'
		]);
	});

	it.each([
		['dashboard', 'Tableau de bord'],
		['users', 'Utilisateurs'],
		['support', 'Support'],
		['settings', 'Paramètres'],
		['audit-log', "Journal d'audit"]
	])('labels the admin %s page in the active language', (segment, label) => {
		expect(buildBreadcrumbs(`/fr/admin/${segment}`, 'admin', 'Admin', 'fr', tFr)).toEqual([
			{ label: 'Admin', href: '/fr/admin', isLast: false },
			{ label, href: `/fr/admin/${segment}`, isLast: true }
		]);
	});

	it('follows a language change for the same page', () => {
		const path = '/admin/audit-log';
		expect(labels(buildBreadcrumbs(path, 'admin', 'Admin', 'de', tDe))).toEqual([
			'Admin',
			'Audit-Log'
		]);
		expect(labels(buildBreadcrumbs(path, 'admin', 'Admin', 'fr', tFr))).toEqual([
			'Admin',
			"Journal d'audit"
		]);
	});

	it('matches the full route, so a known segment under another prefix stays a fallback', () => {
		expect(labels(buildBreadcrumbs('/de/admin/users', 'admin', 'Admin', 'de', tDe))).toEqual([
			'Admin',
			'Benutzer'
		]);
		expect(labels(buildBreadcrumbs('/de/app/users', 'app', 'App', 'de', tDe))).toEqual([
			'App',
			'Users'
		]);
	});

	it('keeps readable fallbacks and cumulative hrefs for unknown routes and ids', () => {
		expect(
			buildBreadcrumbs('/de/admin/users/abc-123/members', 'admin', 'Admin', 'de', tDe)
		).toEqual([
			{ label: 'Admin', href: '/de/admin', isLast: false },
			{ label: 'Benutzer', href: '/de/admin/users', isLast: false },
			{ label: 'Abc 123', href: '/de/admin/users/abc-123', isLast: false },
			{ label: 'Members', href: '/de/admin/users/abc-123/members', isLast: true }
		]);
	});

	it('never shows a raw translation key when a title is missing', () => {
		const missing = (key: string) => key;
		expect(
			labels(buildBreadcrumbs('/en/admin/audit-log', 'admin', 'Admin', 'en', missing))
		).toEqual(['Admin', 'Audit Log']);
	});

	it('falls back to the default language when lang is undefined', () => {
		expect(buildBreadcrumbs('/app/settings', 'app', 'App', undefined, tEn)).toEqual([
			{ label: 'App', href: '/en/app', isLast: false },
			{ label: 'Settings', href: '/en/app/settings', isLast: true }
		]);
	});

	it('returns an empty array when the prefix does not match', () => {
		expect(buildBreadcrumbs('/en/marketing', 'app', 'App', 'en', tEn)).toEqual([]);
	});

	it('returns an empty array for the root path', () => {
		expect(buildBreadcrumbs('/', 'app', 'App', 'en', tEn)).toEqual([]);
	});
});
