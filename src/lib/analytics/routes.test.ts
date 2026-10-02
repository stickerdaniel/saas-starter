import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANALYTICS_ROUTES, NOT_FOUND_PATH, reportedPath } from './routes';

const ROUTES_DIR = join(process.cwd(), 'src/routes');

function pageRoutes(dir: string): string[] {
	const routes: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) routes.push(...pageRoutes(path));
		else if (entry === '+page.svelte') {
			const segments = relative(ROUTES_DIR, dir)
				.split(sep)
				.filter((segment) => segment && segment !== '[[lang]]' && !/^\(.+\)$/.test(segment));
			routes.push(`/${segments.join('/')}`);
		}
	}
	return routes;
}

describe('ANALYTICS_ROUTES', () => {
	it('lists exactly the page routes in src/routes', () => {
		// A new page is reported as /404 until it is added to ANALYTICS_ROUTES in
		// src/lib/analytics/routes.ts. Add it there; check that a [param] never needs to
		// be reported by value.
		expect([...ANALYTICS_ROUTES].sort()).toEqual(pageRoutes(ROUTES_DIR).sort());
	});
});

describe('reportedPath', () => {
	it('keeps known routes with and without a locale', () => {
		expect(reportedPath('/')).toBe('/');
		expect(reportedPath('/en')).toBe('/en');
		expect(reportedPath('/de/pricing')).toBe('/de/pricing');
		expect(reportedPath('/fr/app/settings/')).toBe('/fr/app/settings');
		expect(reportedPath('/app/ai-chat')).toBe('/app/ai-chat');
	});

	it('reports everything else as the 404 path', () => {
		for (const path of [
			'/en/jane-doe',
			'/en/private-medical-note',
			'/it/pricing',
			'/en/pricing/extra',
			'/en/app/%40me'
		]) {
			expect(reportedPath(path)).toBe(NOT_FOUND_PATH);
		}
	});
});
