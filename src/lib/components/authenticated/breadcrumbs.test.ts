import { describe, expect, it } from 'vitest';
import { buildBreadcrumbs } from './breadcrumbs';

describe('buildBreadcrumbs', () => {
	it('returns the root crumb only for the bare prefix with a language segment', () => {
		expect(buildBreadcrumbs('/en/app', 'app', 'App', 'en')).toEqual([
			{ label: 'App', href: '/en/app', isLast: true }
		]);
	});

	it('returns the root crumb only for the bare prefix without a language segment', () => {
		expect(buildBreadcrumbs('/app', 'app', 'App', 'en')).toEqual([
			{ label: 'App', href: '/en/app', isLast: true }
		]);
	});

	it('renders a 2-level path with the leaf marked isLast', () => {
		expect(buildBreadcrumbs('/en/app/settings', 'app', 'App', 'en')).toEqual([
			{ label: 'App', href: '/en/app', isLast: false },
			{ label: 'Settings', href: '/en/app/settings', isLast: true }
		]);
	});

	it('renders all intermediate segments for a 3-level path with cumulative hrefs', () => {
		expect(buildBreadcrumbs('/en/app/settings/sessions', 'app', 'App', 'en')).toEqual([
			{ label: 'App', href: '/en/app', isLast: false },
			{ label: 'Settings', href: '/en/app/settings', isLast: false },
			{ label: 'Sessions', href: '/en/app/settings/sessions', isLast: true }
		]);
	});

	it('preserves a non-default locale across all hrefs', () => {
		expect(buildBreadcrumbs('/de/app/settings/sessions', 'app', 'App', 'de')).toEqual([
			{ label: 'App', href: '/de/app', isLast: false },
			{ label: 'Settings', href: '/de/app/settings', isLast: false },
			{ label: 'Sessions', href: '/de/app/settings/sessions', isLast: true }
		]);
	});

	it('falls back to the default language when lang is undefined', () => {
		expect(buildBreadcrumbs('/app/settings', 'app', 'App', undefined)).toEqual([
			{ label: 'App', href: '/en/app', isLast: false },
			{ label: 'Settings', href: '/en/app/settings', isLast: true }
		]);
	});

	it('formats kebab-case segments to title case', () => {
		expect(buildBreadcrumbs('/en/app/community-chat', 'app', 'App', 'en')).toEqual([
			{ label: 'App', href: '/en/app', isLast: false },
			{ label: 'Community Chat', href: '/en/app/community-chat', isLast: true }
		]);
	});

	it('renders a 4-level path with cumulative hrefs through dynamic-looking segments', () => {
		expect(buildBreadcrumbs('/en/admin/users/abc-123/members', 'admin', 'Admin', 'en')).toEqual([
			{ label: 'Admin', href: '/en/admin', isLast: false },
			{ label: 'Users', href: '/en/admin/users', isLast: false },
			{ label: 'Abc 123', href: '/en/admin/users/abc-123', isLast: false },
			{ label: 'Members', href: '/en/admin/users/abc-123/members', isLast: true }
		]);
	});

	it('returns an empty array when the prefix does not match', () => {
		expect(buildBreadcrumbs('/en/marketing', 'app', 'App', 'en')).toEqual([]);
	});

	it('returns an empty array for the root path', () => {
		expect(buildBreadcrumbs('/', 'app', 'App', 'en')).toEqual([]);
	});
});
