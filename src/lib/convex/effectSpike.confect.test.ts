// @vitest-environment node
/// <reference types="vite/client" />
import { FunctionSpec, Ref } from '@confect/core';
import { TestConfect } from '@confect/test';
import { expect, it } from '@effect/vitest';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import databaseSchema from '../confect/schema';
import { convexModules } from './convexTest.modules';
import schema from './schema';

// Confect's own harness: a ref call encodes the args and decodes the returns
// with the spec's schemas, on top of convex-test.
const Test = TestConfect.TestConfect<typeof databaseSchema>();
// A ref needs only the function name and its schemas, as a client holds them.
const stressQuery = Ref.make(
	'effectSpike/probes',
	FunctionSpec.internalQuery({
		name: 'stressQuery',
		returns: () => Schema.Struct({ items: Schema.Finite, autoYielded: Schema.Boolean })
	})
);

it.effect('a Confect ref runs the 3,000-step stress through @confect/test', () =>
	Effect.gen(function* () {
		const t = yield* Test;
		expect(yield* t.query(stressQuery, {})).toEqual({ items: 3_000, autoYielded: true });
	}).pipe(Effect.provide(TestConfect.layer(databaseSchema, schema, convexModules)))
);
