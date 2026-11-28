// @vitest-environment node
/// <reference types="vite/client" />
import { inspect } from 'node:util';
import { FunctionSpec, GroupSpec } from '@confect/core';
import { FunctionImpl, GroupImpl, HttpRouter, RegisteredFunctions } from '@confect/server';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as EffectHttpRouter from 'effect/http/HttpRouter';
import * as HttpServerResponse from 'effect/http/HttpServerResponse';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import schema from '../convex/schema';
import databaseSchema from '../confect/_generated/schema';
import { convexModules } from '../confect/convexTest.modules';
import { runServerEffect } from './effect-runtime';

const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;

const failure = Cause.fail('quota exhausted');

const lines = [
	[Effect.log('text', { id: 1 }, 3), 'log', ['text', { id: 1 }, 3]],
	[Effect.logInfo('[probe] info'), 'log', ['[probe] info']],
	[Effect.logWarning({ code: 'probe_warn' }), 'warn', [{ code: 'probe_warn' }]],
	[
		Effect.logError({ code: 'probe_error', userId: 'u1' }),
		'error',
		[{ code: 'probe_error', userId: 'u1' }]
	],
	[Effect.logFatal('fatal'), 'error', ['fatal']],
	[Effect.logDebug(`Deleting ${2} files...`), 'debug', [`Deleting ${2} files...`]],
	[Effect.logError('with a cause', failure), 'error', ['with a cause', failure]]
] as const;

const logEveryLevel = Effect.forEach(lines, ([log]) => log, { discard: true });

const line = (method: (typeof methods)[number], args: readonly unknown[]) =>
	`${method} ${args.map((arg) => inspect(arg, { depth: 8 })).join(' ')}`;

function capture() {
	const written: string[] = [];
	for (const method of methods) {
		vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
			written.push(line(method, args));
		});
	}
	return written;
}

const direct = () => lines.map(([, method, args]) => line(method, args));

const probe = GroupSpec.make()
	.addFunction(FunctionSpec.publicQuery({ name: 'query', returns: () => Schema.Null }))
	.addFunction(FunctionSpec.publicMutation({ name: 'mutation', returns: () => Schema.Null }))
	.addFunction(FunctionSpec.publicAction({ name: 'action', returns: () => Schema.Null }));

const logged = () => logEveryLevel.pipe(Effect.as(null));

const route = EffectHttpRouter.add('GET', '/log-probe', () =>
	logEveryLevel.pipe(Effect.as(HttpServerResponse.empty({ status: 204 })))
);

const harness = () =>
	convexTest(schema, {
		...convexModules,
		'../convex/http.ts': async () => ({ default: HttpRouter.make(route) }),
		'../convex/logProbe.ts': async () =>
			RegisteredFunctions.buildForGroup<typeof probe>(
				databaseSchema,
				GroupImpl.make(databaseSchema, probe).pipe(
					Layer.provide([
						FunctionImpl.make(databaseSchema, probe, 'query', logged),
						FunctionImpl.make(databaseSchema, probe, 'mutation', logged),
						FunctionImpl.make(databaseSchema, probe, 'action', logged)
					]),
					GroupImpl.finalize
				)
			)
	});

const runners = {
	'a Confect query': () =>
		harness().query(
			makeFunctionReference<'query', Record<string, never>, null>('logProbe:query'),
			{}
		),
	'a Confect mutation': () =>
		harness().mutation(
			makeFunctionReference<'mutation', Record<string, never>, null>('logProbe:mutation'),
			{}
		),
	'a Confect action': () =>
		harness().action(
			makeFunctionReference<'action', Record<string, never>, null>('logProbe:action'),
			{}
		),
	'a Confect HTTP route': async () => {
		const response = await harness().fetch('/log-probe');
		expect(response.status).toBe(204);
	},
	runServerEffect: () => runServerEffect(logEveryLevel)
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe('Effect logs', () => {
	it.each(Object.entries(runners))(
		'in %s write the console arguments of a direct call, Debug included',
		async (_, run) => {
			const expected = direct();
			const written = capture();
			await run();
			expect(written).toEqual(expected);
			expect(written.filter((line) => line.startsWith('debug '))).toHaveLength(1);
		}
	);
});
