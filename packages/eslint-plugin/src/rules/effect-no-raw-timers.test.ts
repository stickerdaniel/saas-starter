import { describe, expect, it } from 'vitest';
import { lintRule } from './effect-rule-harness';
import rule from './effect-no-raw-timers.js';

const options = { files: ['src/lib/effect/**'], allow: ['**/*.test.ts'] };
const lint = (code: string, file = 'src/lib/effect/flow.ts') =>
	lintRule(rule, code, { file, options });

describe('effect-no-raw-timers', () => {
	it.each([
		'setTimeout(tick, 100);',
		'setInterval(tick, 100);',
		'setImmediate(tick);',
		'globalThis.setTimeout(tick, 100);',
		"window['setInterval'](tick, 100);",
		'await new Promise((resolve) => setTimeout(resolve, 100));'
	])('reports a raw timer: %s', (code) => {
		expect(lint(code)).toEqual([{ messageId: 'rawTimer', line: 1 }]);
	});

	it.each([
		"import * as Effect from 'effect/Effect';\nEffect.sleep('100 millis');",
		'lifetime.after(100, tick);',
		'const setTimeout = (fn: () => void) => fn();\nsetTimeout(tick);',
		'clock.setTimeout(tick, 100);'
	])('allows Effect timing and shadowed names: %s', (code) => {
		expect(lint(code)).toEqual([]);
	});

	it.each(['src/lib/effect/flow.test.ts', 'src/lib/chat/ui/debounce.ts'])(
		'checks only the configured files: %s',
		(file) => {
			expect(lint('setTimeout(tick, 100);', file)).toEqual([]);
		}
	);
});
