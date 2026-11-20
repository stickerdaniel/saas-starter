import { describe, expect, it } from 'vitest';
import { lintRule } from './effect-rule-harness';
import rule from './effect-no-promise-race.js';

const lint = (code: string, file?: string) =>
	lintRule(rule, code, { file, options: { files: ['src/lib/effect/**'] } });

describe('effect-no-promise-race', () => {
	it.each(['await Promise.race([work, timeout]);', "await Promise['race']([work, timeout]);"])(
		'reports Promise.race: %s',
		(code) => {
			expect(lint(code)).toEqual([{ messageId: 'promiseRace', line: 1 }]);
		}
	);

	it.each([
		'await Promise.all([a, b]);',
		"import * as Effect from 'effect/Effect';\nEffect.race(a, b);",
		'const Promise = { race: (x: unknown) => x };\nPromise.race([a]);'
	])('allows other combinators and shadowed names: %s', (code) => {
		expect(lint(code)).toEqual([]);
	});

	it('checks only the configured files', () => {
		expect(lint('await Promise.race([work, timeout]);', 'src/lib/server/fetch.ts')).toEqual([]);
	});
});
