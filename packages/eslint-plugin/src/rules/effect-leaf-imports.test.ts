import { describe, expect, it } from 'vitest';
import { lintRule } from './effect-rule-harness';
import rule from './effect-leaf-imports.js';

const leaves = ['errors', 'retry', 'timeout', 'lifetime', 'scheduler', 'clock', 'testing'].map(
	(name) => `src/lib/effect/${name}.ts`
);
const lint = (code: string, file = 'src/lib/effect/retry.ts') =>
	lintRule(rule, code, { file, options: { files: leaves } });

describe('effect-leaf-imports', () => {
	it.each([
		"import { Effect } from 'effect';",
		"import type { Effect } from 'effect';",
		"import { api } from '../convex/_generated/api';",
		"import { runtime } from './client-runtime';",
		"import { it } from '@effect/vitest';",
		"import { v } from 'convex/values/extra';",
		"export * from '#lib/utils';",
		"export { within } from '../server/timeout';",
		'const mod = await import(path);',
		"const runtime = require('../server/effect-runtime');",
		"const runtime = module.require('../server/effect-runtime');",
		'const mod = require(path);'
	])('reports an import outside the leaf set: %s', (code) => {
		expect(lint(code)).toEqual([{ messageId: 'leafImport', line: 1 }]);
	});

	it.each([
		"import * as Effect from 'effect/Effect';",
		"import * as TestClock from 'effect/testing/TestClock';",
		"import { v } from 'convex/values';",
		"import { isRetryable } from './errors';",
		"import { isRetryable } from './errors.ts';",
		"import { syncScheduler } from './scheduler.js';",
		"export { adjust } from 'effect/testing/TestClock';",
		"const { isRetryable } = require('./errors');"
	])('allows effect subpaths, convex/values and sibling leaves: %s', (code) => {
		expect(lint(code)).toEqual([]);
	});

	it('checks only the leaf modules', () => {
		expect(lint("import { Effect } from 'effect';", 'src/lib/effect/vitest.ts')).toEqual([]);
	});
});
