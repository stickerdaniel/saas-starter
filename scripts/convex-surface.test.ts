import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { surfaceOf } from './convex-surface';

// A miniature Convex tree with its own generated api.d.ts, shaped the way the
// CLI writes one. What the walker reads is Convex's own FilterApi output, so
// these assertions pin the reading, not a re-derivation of what it publishes.
const surface = surfaceOf(path.join(__dirname, '__fixtures__/convex-surface'));

describe('surfaceOf', () => {
	it('reads kind and visibility off the published reference', () => {
		expect(surface.get('plain:rename')).toEqual({ kind: 'mutation', visibility: 'public' });
		expect(surface.get('plain:read')).toEqual({ kind: 'query', visibility: 'public' });
	});

	it('reaches functions in a nested module', () => {
		expect(surface.get('area/nested:sweep')).toEqual({ kind: 'action', visibility: 'internal' });
	});

	// `components` sits beside `api` in the generated file and is not callable
	// through it, so a component's functions are not this tree's promise.
	it('leaves the components namespace out', () => {
		expect([...surface.keys()].some((key) => key.startsWith('some'))).toBe(false);
	});

	// Convex's own FilterApi rejects a value that only looks like a
	// registration. A classifier matching the markers itself counted this, and
	// on the current side that could satisfy a promise a real deletion broke.
	it('does not count a marker-shaped impostor', () => {
		expect(surface.has('plain:impostor')).toBe(false);
	});

	// Whatever the reason a module is missing from the generated api — a
	// component directory, a schema, a multi-dot name, a `.cjs` module whose
	// named exports Convex never emits — it publishes nothing.
	it('ignores a module the generated api does not list', () => {
		expect(surface.has('unlisted/hidden:unreachable')).toBe(false);
	});

	it('found nothing else in the fixture', () => {
		expect([...surface.keys()].sort()).toEqual(['area/nested:sweep', 'plain:read', 'plain:rename']);
	});

	// An unresolvable import types its registrations as `any`, which would drop
	// them out of the surface silently. On a baseline checkout that is how a
	// dependency migration erases the promise the old code made.
	it('refuses a tree whose imports do not resolve', () => {
		expect(() => surfaceOf(path.join(__dirname, '__fixtures__/convex-surface-broken'))).toThrow(
			/a-package-that-does-not-exist/
		);
	});

	it('refuses a tree with no generated api', () => {
		expect(() => surfaceOf(path.join(__dirname, '__fixtures__'))).toThrow(/api\.d\.ts/);
	});
});
