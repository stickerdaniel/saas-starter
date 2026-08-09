import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { surfaceOf } from './convex-surface';

// One checker run over the fixture tree; the assertions below pin the
// classifier the consumer-compat check stands on.
const surface = surfaceOf(path.join(__dirname, '__fixtures__/convex-surface'));

describe('surfaceOf', () => {
	it('counts direct registrations with kind and visibility', () => {
		expect(surface.get('registrations:direct')).toEqual({
			kind: 'mutation',
			visibility: 'public'
		});
		expect(surface.get('registrations:directInternal')).toEqual({
			kind: 'mutation',
			visibility: 'internal'
		});
		expect(surface.get('registrations:directQuery')).toEqual({
			kind: 'query',
			visibility: 'public'
		});
		expect(surface.get('registrations:directAction')).toEqual({
			kind: 'action',
			visibility: 'public'
		});
	});

	it('counts an alias, a named type alias, and a re-export', () => {
		expect(surface.get('registrations:aliased')).toEqual({
			kind: 'mutation',
			visibility: 'public'
		});
		// The printed type is the alias name; the structure still registers.
		expect(surface.get('registrations:named')).toEqual({
			kind: 'mutation',
			visibility: 'public'
		});
		expect(surface.get('reexports:reexported')).toEqual({
			kind: 'mutation',
			visibility: 'public'
		});
	});

	it('counts a registration in every entry extension Convex bundles', () => {
		expect(surface.get('module:fromMts')).toEqual({
			kind: 'mutation',
			visibility: 'public'
		});
	});

	// The false passes the type-name matching allowed: values that mention a
	// registered function without being one.
	it('rejects containers, producers, mixed unions, and plain values', () => {
		expect(surface.has('registrations:wrappedObject')).toBe(false);
		expect(surface.has('registrations:inTuple')).toBe(false);
		expect(surface.has('registrations:producer')).toBe(false);
		expect(surface.has('registrations:mixedUnion')).toBe(false);
		expect(surface.has('registrations:plainValue')).toBe(false);
	});

	// The false passes marker presence alone would allow: Convex's own filter
	// demands markers that are literally true, and its strict compilation keeps
	// `| undefined` a union the generated api omits.
	it('rejects false-valued markers and a conditionally disabled export', () => {
		expect(surface.has('registrations:falseMarkers')).toBe(false);
		expect(surface.has('registrations:conditional')).toBe(false);
	});

	it('found nothing else in the fixtures', () => {
		expect([...surface.keys()].sort()).toEqual([
			'module:fromMts',
			'reexports:reexported',
			'registrations:aliased',
			'registrations:direct',
			'registrations:directAction',
			'registrations:directInternal',
			'registrations:directQuery',
			'registrations:named'
		]);
	});
});
