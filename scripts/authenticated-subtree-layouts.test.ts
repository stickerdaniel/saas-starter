import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

// Regression guard for the prerendered-marketing -> authed-subtree navigation
// dead end (#289 -> #575 -> the app/admin layout fix).
//
// The root +layout.server.ts resolves auth data, but marketing pages freeze it
// at build time (viewer null). SvelteKit never reruns a parent server load on
// client-side navigation (sveltejs/kit#4426), so every authenticated top-level
// subtree needs its own +layout.server.ts that re-resolves the auth block, or
// a client-side navigation into it from a prerendered page renders the frozen
// unauthenticated data and dead-ends in AuthConnectionFallback.
//
// The subtrees share one load (authedSubtreeLayoutLoad in
// $lib/server/auth-layout-data) so the isDataRequest guard and returned keys
// cannot silently diverge between /app and /admin; the exact re-export line is
// pinned here.
//
// hooks.server.ts gates exactly two top-level subtrees behind auth
// (isProtectedRoute -> /app, isAdminRoute -> /admin). If a third is ever added
// there, add it here too and give it a layout load, or it inherits the bug.

const AUTHED_SUBTREES = ['app', 'admin'];

const SHARED_LOAD_REEXPORT =
	"export { authedSubtreeLayoutLoad as load } from '$lib/server/auth-layout-data';";

describe('authenticated subtree layout loads', () => {
	for (const subtree of AUTHED_SUBTREES) {
		it(`/${subtree} re-resolves auth data via the shared subtree layout load`, () => {
			const file = path.resolve('src/routes/[[lang]]', subtree, '+layout.server.ts');
			expect(fs.existsSync(file), `${subtree}/+layout.server.ts is missing`).toBe(true);

			const content = fs.readFileSync(file, 'utf-8');
			expect(
				content.includes(SHARED_LOAD_REEXPORT),
				`${subtree}/+layout.server.ts must re-export authedSubtreeLayoutLoad verbatim so the subtree guards cannot diverge`
			).toBe(true);
		});
	}

	it('the shared load still resolves the auth block behind the isDataRequest guard', () => {
		const shared = fs.readFileSync(path.resolve('src/lib/server/auth-layout-data.ts'), 'utf-8');
		expect(shared).toContain('export const authedSubtreeLayoutLoad');
		expect(shared).toContain('event.isDataRequest');
		expect(shared).toContain('resolveAuthLayoutData(event)');
	});

	it('hooks.server.ts still gates only the guarded subtrees (add new ones above)', () => {
		const hooks = fs.readFileSync(path.resolve('src/hooks.server.ts'), 'utf-8');
		// Pins the assumption that /app and /admin are the authenticated subtrees.
		// If these route matchers change, AUTHED_SUBTREES above must be revisited.
		expect(hooks).toContain('isProtectedRoute');
		expect(hooks).toContain('isAdminRoute');
		for (const subtree of AUTHED_SUBTREES) {
			expect(
				hooks.includes(`/${subtree}(`),
				`hooks.server.ts no longer matches /${subtree}; revisit AUTHED_SUBTREES`
			).toBe(true);
		}
	});
});
