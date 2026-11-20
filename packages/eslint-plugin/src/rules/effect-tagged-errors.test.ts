import { describe, expect, it } from 'vitest';
import { lintRule } from './effect-rule-harness';
import rule from './effect-tagged-errors.js';

const lint = (code: string, file?: string) =>
	lintRule(rule, code, { file, options: { files: ['src/lib/effect/**'] } });

describe('effect-tagged-errors', () => {
	it.each([
		'class Lost extends Error {}',
		'export class Invalid extends TypeError {}',
		'const Lost = class extends Error {};'
	])('reports an Error subclass: %s', (code) => {
		expect(lint(code)).toEqual([{ messageId: 'errorSubclass', line: 1 }]);
	});

	it.each([
		"import * as Data from 'effect/Data';\nclass Lost extends Data.TaggedError('Lost')<{ cause: unknown }> {}",
		'class Base {}\nclass Child extends Base {}',
		"import { Error } from './local-error';\nclass Lost extends Error {}"
	])('allows tagged errors and non-builtin bases: %s', (code) => {
		expect(lint(code)).toEqual([]);
	});

	it('checks only the configured files', () => {
		expect(lint('class Lost extends Error {}', 'src/lib/components/form.ts')).toEqual([]);
	});
});
