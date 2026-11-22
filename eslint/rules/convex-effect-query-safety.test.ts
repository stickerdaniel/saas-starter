import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Linter } from 'eslint';
import { parser } from 'typescript-eslint';
import { afterAll, describe, expect, it } from 'vitest';
import rule from './convex-effect-query-safety.js';

const config = [
	{
		files: ['**/*.ts'],
		languageOptions: { parser },
		plugins: { local: { rules: { 'convex-effect-query-safety': rule } } },
		rules: { 'local/convex-effect-query-safety': 'error' as const }
	}
];

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'convex-effect-query-safety-'));
const linter = new Linter({ configType: 'flat', cwd: directory });
fs.writeFileSync(
	path.join(directory, 'notes.spec.ts'),
	`import { FunctionSpec, GroupSpec } from '@confect/core';
import type { sweep } from './notes';
export default GroupSpec.make()
	.addFunction(FunctionSpec.publicQuery({ name: 'list', args: () => ({}), returns: () => Schema.Null }))
	.addFunction(FunctionSpec.internalMutation({ name: 'touch', returns: () => Schema.Null }))
	.addFunction(FunctionSpec.publicAction({ name: 'sync', returns: () => Schema.Null }))
	.addFunction(FunctionSpec.convexInternalMutation<typeof sweep>()('sweep'));
`
);

afterAll(() => {
	fs.rmSync(directory, { recursive: true, force: true });
});

const imports = `import * as Effect from 'effect/Effect';
import * as Schedule from 'effect/Schedule';
import { sleep } from 'effect/Effect';
import { withRetry } from '../../effect/retry';
import { within } from '$lib/effect/timeout';
import { withRetry as retryOther } from './retry';
import { mutation, query, action, internalAction } from './_generated/server';
import { authedMutation } from './functions';
import { FunctionImpl } from '@confect/server';
import notes from './notes.spec';
import missing from './missing.spec';
`;

function lint(code: string) {
	return linter
		.verify(`${imports}${code}`, config, { filename: path.join(directory, 'notes.impl.ts') })
		.map(({ messageId, message }) => ({ messageId, name: /`([^`]+)`/.exec(message)?.[1] }));
}

const registered = (builder: string, statement: string) =>
	`export const f = ${builder}({ args: {}, handler: async (ctx) => { const program = ${statement}; return null; } });`;

const implemented = (name: string, step: string, group = 'notes') =>
	`export const f = FunctionImpl.make(databaseSchema, ${group}, '${name}', () => Effect.gen(function* () { yield* ${step}; return null; }));`;

describe('convex-effect-query-safety', () => {
	it.each([
		["Effect.sleep('1 second')", 'Effect.sleep'],
		["sleep('1 second')", 'Effect.sleep'],
		["Effect.timeout(work, '1 second')", 'Effect.timeout'],
		["work.pipe(Effect.timeoutOption('1 second'))", 'Effect.timeoutOption'],
		["Effect.repeat(work, Schedule.spaced('1 second'))", 'Schedule.spaced'],
		['Effect.forkChild(work)', 'Effect.forkChild'],
		['work.pipe(Effect.forkDetach)', 'Effect.forkDetach'],
		['withRetry(work)', 'withRetry'],
		["within(work, '1 second')", 'within']
	])('reports %s in a query handler', (statement, name) => {
		expect(lint(registered('query', statement))).toEqual([{ messageId: 'timer', name }]);
	});

	it('reports a timer in a custom mutation builder handler', () => {
		expect(lint(registered('authedMutation', "Effect.sleep('1 second')"))).toEqual([
			{ messageId: 'timer', name: 'Effect.sleep' }
		]);
	});

	it.each([
		['an action handler', registered('action', "Effect.sleep('1 second')")],
		['an internal action handler', registered('internalAction', 'withRetry(work)')],
		[
			'an immediate fork',
			registered('mutation', 'Effect.forkChild(work, { startImmediately: true })')
		],
		['a lookalike retry helper', registered('mutation', 'retryOther(work)')],
		['a timer outside any handler', "export const later = Effect.sleep('1 second');"],
		['a synchronous Effect step', registered('query', 'Effect.succeed(1)')]
	])('passes %s', (_label, code) => {
		expect(lint(code)).toEqual([]);
	});

	it.each([
		['a native query', 'list'],
		['a native internal mutation', 'touch'],
		['a plain-provenance mutation', 'sweep']
	])('reports a timer in the implementation of %s', (_label, name) => {
		expect(lint(implemented(name, "Effect.sleep('1 second')"))).toEqual([
			{ messageId: 'timer', name: 'Effect.sleep' }
		]);
	});

	it('passes a timer in the implementation of a native action', () => {
		expect(lint(implemented('sync', "Effect.sleep('1 second')"))).toEqual([]);
	});

	it('checks an implementation whose spec it cannot read', () => {
		expect(lint(implemented('sync', "Effect.sleep('1 second')", 'missing'))).toEqual([
			{ messageId: 'timer', name: 'Effect.sleep' }
		]);
	});
});
