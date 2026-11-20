import { describe, expect, it } from 'vitest';
import { lintRule } from './effect-rule-harness';
import rule from './effect-subpath-import.js';

const lint = (code: string, file?: string) => lintRule(rule, code, { file });

describe('effect-subpath-import', () => {
	it.each([
		`import { Effect } from 'effect';`,
		`import * as E from 'effect';`,
		`import 'effect';`,
		`import { type Schema, Effect } from 'effect';`,
		`export { Effect } from 'effect';`,
		`export * from 'effect';`,
		`const effect = await import('effect');`
	])('reports a runtime use of the barrel: %s', (code) => {
		expect(lint(code)).toEqual([{ messageId: 'barrel', line: 1 }]);
	});

	it.each([
		`import * as Effect from 'effect/Effect';`,
		`import type { Effect } from 'effect';`,
		`import { type Effect, type Layer } from 'effect';`,
		`export type { Effect } from 'effect';`,
		`import { TestClock } from 'effect/testing';`
	])('allows subpaths and type-only barrel imports: %s', (code) => {
		expect(lint(code)).toEqual([]);
	});

	it('checks only the configured files', () => {
		expect(lint(`import { Effect } from 'effect';`, 'scripts/tool.ts')).toEqual([]);
	});
});
