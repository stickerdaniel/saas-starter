import { describe, expect, it } from 'vitest';
import { admin } from 'better-auth/plugins/admin';
import { COOKIE_BOUND_ADMIN_PATHS, DISABLED_ADMIN_PATHS } from './adminHttpPaths';

/**
 * Regression guard for #484: the admin plugin's raw HTTP endpoints bypass
 * the custom mutations' guards and atomic audit writes. Every plugin
 * endpoint must therefore be explicitly classified: disabled at the router,
 * or cookie-bound (impersonation, audited via session triggers). A
 * better-auth upgrade that adds admin endpoints fails here until the new
 * path is classified in adminHttpPaths.ts.
 */
describe('better-auth admin plugin HTTP surface', () => {
	const pluginPaths = Object.values(admin().endpoints).map(
		(endpoint) => (endpoint as { path: string }).path
	);
	const classifiedPaths: readonly string[] = [...DISABLED_ADMIN_PATHS, ...COOKIE_BOUND_ADMIN_PATHS];

	it('classifies every admin plugin endpoint as disabled or cookie-bound', () => {
		const classified = new Set(classifiedPaths);
		const unclassified = pluginPaths.filter((path) => !classified.has(path));
		expect(unclassified).toEqual([]);
	});

	it('contains no stale or misspelled paths', () => {
		const actual = new Set(pluginPaths);
		const stale = classifiedPaths.filter((path) => !actual.has(path));
		expect(stale).toEqual([]);
	});

	it('keeps the disabled and cookie-bound lists disjoint', () => {
		const cookieBound = new Set<string>(COOKIE_BOUND_ADMIN_PATHS);
		const overlap = DISABLED_ADMIN_PATHS.filter((path) => cookieBound.has(path));
		expect(overlap).toEqual([]);
	});
});
