import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { freshSurfaceOf, matchSourceFingerprintProfile, surfaceOf } from './convex-surface';

// A miniature Convex tree with its own generated api.d.ts, shaped the way the
// CLI writes one. What the walker reads is Convex's own FilterApi output, so
// these assertions pin the reading, not a re-derivation of what it publishes.
const surface = surfaceOf(path.join(__dirname, '__fixtures__/convex-surface'));

describe('source fingerprint profiles', () => {
	const profiles = [
		{ version: '1.0.0', modulePathSort: 'native', hashes: { traversal: 'a', codegen: 'b' } },
		{
			version: '2.0.0',
			modulePathSort: 'compareModulePaths',
			hashes: { traversal: 'a', codegen: 'c' }
		}
	] as const;

	it('accepts one complete version profile without mixing fingerprints', () => {
		expect(
			matchSourceFingerprintProfile('2.0.0', { traversal: 'a', codegen: 'c' }, profiles)
		).toMatchObject({ version: '2.0.0', modulePathSort: 'compareModulePaths' });
		expect(
			matchSourceFingerprintProfile('2.0.0', { traversal: 'a', codegen: 'b' }, profiles)
		).toBeNull();
		expect(
			matchSourceFingerprintProfile('1.0.0', { traversal: 'a', codegen: 'b', extra: 'c' }, profiles)
		).toBeNull();
	});
});

describe('surfaceOf', () => {
	it('reads kind and visibility off the published reference', () => {
		expect(surface.get('plain:rename')).toEqual({ kind: 'mutation', visibility: 'public' });
		expect(surface.get('plain:read')).toEqual({ kind: 'query', visibility: 'public' });
	});

	it('reaches functions in a nested module', () => {
		expect(surface.get('area/nested:sweep')).toEqual({ kind: 'action', visibility: 'internal' });
	});

	// A generated API node can be both a function and a namespace: foo.ts
	// exports bar, while foo/bar.ts exports baz. Both promises must survive.
	it('keeps walking when a function is also a namespace', () => {
		expect(surface.get('foo:bar')).toEqual({ kind: 'query', visibility: 'public' });
		expect(surface.get('foo/bar:baz')).toEqual({ kind: 'query', visibility: 'public' });
	});

	it('does not confuse a marker-named module with the reference marker', () => {
		expect(surface.get('foo/bar/_type:deep')).toEqual({
			kind: 'query',
			visibility: 'public'
		});
	});

	// If a nested namespace exports functions named after all five reference
	// markers, Convex's own FilterApi omits the entire branch. Direct `api.*`
	// consumer syntax cannot address it, so it creates no promise for this guard.
	it('matches FilterApi when all marker names collide', () => {
		expect([...surface.keys()].some((key) => key.startsWith('markers'))).toBe(false);
	});

	it('does not silently truncate a deeply nested module', () => {
		expect(surface.get('a/b/c/d/e/f/g/h/i/j/k/l/m/deep:end')).toEqual({
			kind: 'query',
			visibility: 'public'
		});
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

	// The generated api can omit a module because of a component boundary, a
	// schema, a multi-dot name, or a `.cjs` module whose named exports Convex does
	// not emit. Every omitted module publishes nothing.
	it('ignores a module the generated api does not list', () => {
		expect(surface.has('unlisted/hidden:unreachable')).toBe(false);
	});

	it('refreshes the module list with Convex entry-point discovery', async () => {
		const fresh = await freshSurfaceOf(path.join(__dirname, '__fixtures__/convex-surface'));
		expect(fresh.get('unlisted/hidden:unreachable')).toEqual({
			kind: 'mutation',
			visibility: 'public'
		});
	});

	it('found nothing else in the fixture', () => {
		expect([...surface.keys()].sort()).toEqual([
			'a/b/c/d/e/f/g/h/i/j/k/l/m/deep:end',
			'area/nested:sweep',
			'foo/bar/_type:deep',
			'foo/bar:baz',
			'foo:bar',
			'plain:read',
			'plain:rename'
		]);
	});

	// An unresolvable import types its registrations as `any`, which would drop
	// them out of the surface silently. On a baseline checkout that is how a
	// dependency migration erases the promise the old code made.
	it('refuses a tree whose protected import does not resolve', () => {
		expect(() =>
			surfaceOf(
				path.join(__dirname, '__fixtures__/convex-surface-broken'),
				new Set(['broken:orphan'])
			)
		).toThrow(/broken:orphan|protected api branch/);
	});

	// TypeScript has many diagnostic codes that recover an invalid expression
	// as any. Inspecting the value export catches the effect itself (TS2339 here)
	// so a package API change cannot erase a baseline promise.
	it('refuses a protected API-producing value export that became any', () => {
		expect(() =>
			surfaceOf(path.join(__dirname, '__fixtures__/convex-surface-any'), new Set(['broken:erased']))
		).toThrow(/became any or unknown|protected api branch/);
	});

	it('refuses a protected named re-export that became any', () => {
		expect(() =>
			surfaceOf(
				path.join(__dirname, '__fixtures__/convex-surface-any'),
				new Set(['broken:renamed'])
			)
		).toThrow(/became any or unknown/);
	});

	it('recovers a protected registration erased by an adapter assertion', () => {
		expect(
			surfaceOf(
				path.join(__dirname, '__fixtures__/convex-surface-any'),
				new Set(['broken:adapted'])
			)
		).toEqual(
			new Map([
				['broken:adapted', { kind: 'query', visibility: 'public' }],
				['broken:keep', { kind: 'query', visibility: 'public' }]
			])
		);
	});

	it('does not make an unrelated any export fatal', () => {
		expect(surfaceOf(path.join(__dirname, '__fixtures__/convex-surface-any'))).toEqual(
			new Map([['broken:keep', { kind: 'query', visibility: 'public' }]])
		);
	});

	it('refuses a tree with no generated api', () => {
		expect(() => surfaceOf(path.join(__dirname, '__fixtures__'))).toThrow(/api\.d\.ts/);
	});
});
