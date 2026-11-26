import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Avatars must not use the files-control component's /files/download route: it sends
 * `Cache-Control: no-store` and `Content-Disposition: attachment` and streams the body
 * through the httpAction, so every avatar render downloads the file again. The producer,
 * `finalizeProfileImage` in storage.ts, builds an inline URL; the consumer, http.ts, must
 * register a GET route at that path. `uploadRoute.test.ts` covers the URL the upload
 * route returns. convex-test keeps component storage out of reach of the test, so the
 * redirect itself cannot run here.
 */

const storagePath = path.resolve('src/lib/confect/storage.impl.ts');
const httpPath = path.resolve('src/lib/confect/http.ts');

/** Every way the avatar URL storage.ts builds misses the route http.ts registers. */
function inlineRouteProblems(storage: string, http: string): string[] {
	const route = /\$\{siteUrl\}(\/[\w/-]+)\?token=/.exec(storage)?.[1];
	if (!route) return ['storage.ts builds no tokenized avatar URL'];
	const problems: string[] = [];
	if (route === '/files/download') problems.push('storage.ts builds the component download URL');
	const registered = [...http.matchAll(/http\.route\(\{\s*path: '([^']+)',\s*method: 'GET'/g)].map(
		([, registeredPath]) => registeredPath
	);
	if (!registered.includes(route)) problems.push(`http.ts registers no GET ${route} route`);
	return problems;
}

describe('avatar inline route agreement', () => {
	const storage = fs.readFileSync(storagePath, 'utf-8');
	const http = fs.readFileSync(httpPath, 'utf-8');

	it('registers a GET route at the path of the avatar URL', () => {
		expect(inlineRouteProblems(storage, http)).toEqual([]);
	});

	it('rejects a route that moved away from the avatar URL', () => {
		const moved = http.replace("path: '/files/inline'", "path: '/files/avatar'");
		expect(moved).not.toBe(http);
		expect(inlineRouteProblems(storage, moved)).toEqual([
			'http.ts registers no GET /files/inline route'
		]);
	});
});
