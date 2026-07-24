import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Convention guard on top of the behavioral tests in
 * src/lib/server/cache-control.test.ts: every `public` Cache-Control the
 * policy module sets must sit in a branch guarded by the absence of a session
 * token, so a refactor cannot accidentally serve authenticated documents as
 * publicly cacheable. The response-level assertions live in the co-located
 * unit test; this scan only pins the guard convention.
 */

const policySource = fs.readFileSync(path.resolve('src/lib/server/cache-control.ts'), 'utf-8');

describe('cache-control guard convention', () => {
	it('gates every public cache-control on the absence of a session token', () => {
		const publicSets = [
			...policySource.matchAll(/response\.headers\.set\('Cache-Control', 'public[^']*'\)/g)
		];
		expect(publicSets.length).toBeGreaterThan(0);
		for (const match of publicSets) {
			const before = policySource.slice(0, match.index);
			const guardStart = Math.max(before.lastIndexOf('if ('), before.lastIndexOf('} else if ('));
			const guard = policySource.slice(guardStart, policySource.indexOf(') {', guardStart));
			expect(
				guard,
				`public Cache-Control at offset ${match.index} lacks a !event.locals.token guard`
			).toContain('!event.locals.token');
		}
	});

	it('keeps the hook delegating to the tested policy module', () => {
		const hooksSource = fs.readFileSync(path.resolve('src/hooks.server.ts'), 'utf-8');
		expect(hooksSource).toContain("from '$lib/server/cache-control'");
		expect(hooksSource).toContain('applyCacheControl(event, response)');
	});
});
