import { describe, expect, it } from 'vitest';
import { lintRule } from './effect-rule-harness';
import rule from './effect-run-boundary.js';

const options = {
	files: ['src/**'],
	allow: ['src/lib/effect/lifetime.ts', 'src/lib/server/effect-runtime.ts', '**/*.test.ts']
};
const lint = (code: string, file = 'src/lib/feature/flow.ts') =>
	lintRule(rule, code, { file, options });

describe('effect-run-boundary', () => {
	it.each([
		["import * as Effect from 'effect/Effect';", 'Effect.runPromise(program);'],
		["import * as Effect from 'effect/Effect';", 'Effect.runFork(program, { scheduler });'],
		["import * as E from 'effect/Effect';", 'E.runSync(program);'],
		["import { Effect } from 'effect';", 'Effect.runPromiseExit(program);'],
		["import * as Barrel from 'effect';", 'Barrel.Effect.runFork(program);'],
		["import * as Effect from 'effect/Effect';", "Effect['runFork'](program);"],
		["import * as Effect from 'effect/Effect';", 'const go = Effect.runFork;\ngo(program);'],
		["import * as Effect from 'effect/Effect';", 'const E = Effect;\nE.runPromise(program);'],
		["import * as Effect from 'effect/Effect';", 'const { runSync } = Effect;'],
		["import { runFork as start } from 'effect/Effect';", 'start(program);'],
		["import * as ManagedRuntime from 'effect/ManagedRuntime';", 'ManagedRuntime.make(layer);'],
		["import { make } from 'effect/ManagedRuntime';", 'make(layer);']
	])('reports a runner outside the boundary: %s %s', (imports, code) => {
		expect(lint(`${imports}\n${code}`)).toEqual([expect.objectContaining({ messageId: 'runner' })]);
	});

	it.each([
		`export { runPromise } from 'effect/Effect';`,
		`export { runPromise as run } from 'effect/Effect';`,
		`export * from 'effect/ManagedRuntime';`
	])('reports a re-exported runner: %s', (code) => {
		expect(lint(code)).toEqual([{ messageId: 'runner', line: 1 }]);
	});

	it.each([
		"import * as Effect from 'effect/Effect';\nEffect.gen(function* () {}).pipe(Effect.retry({ times: 1 }));",
		"import * as Effect from 'effect/Effect';\nconst { gen } = Effect;",
		"import * as Layer from 'effect/Layer';\nLayer.make;",
		'const Effect = { runPromise: (x: unknown) => x };\nEffect.runPromise(1);',
		"import typescript from 'typescript';\nimport ts = typescript;\nts.runFork();",
		"import * as Effect from 'effect/Effect';\nfunction f(Effect: { runPromise(): void }) { Effect.runPromise(); }"
	])('allows non-runner members and unrelated bindings: %s', (code) => {
		expect(lint(code)).toEqual([]);
	});

	it.each(['src/lib/effect/lifetime.ts', 'src/lib/feature/flow.test.ts'])(
		'allows the configured runtime modules: %s',
		(file) => {
			expect(
				lint("import * as Effect from 'effect/Effect';\nEffect.runFork(program);", file)
			).toEqual([]);
		}
	);
});
