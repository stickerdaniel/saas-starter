import { describe, expect, it } from 'vitest';
import { lintRule } from './effect-rule-harness';
import rule from './effect-no-try-in-gen.js';

const lint = (code: string, file?: string) =>
	lintRule(rule, code, { file, options: { files: ['src/lib/effect/**'] } });

const effectImport = "import * as Effect from 'effect/Effect';\n";

describe('effect-no-try-in-gen', () => {
	it.each([
		'Effect.gen(function* () {\n\ttry { yield* load; } catch {}\n});',
		"Effect.fn('load')(function* () {\n\ttry { yield* load; } finally { done(); }\n});",
		'Effect.fn(function* () {\n\ttry { step(); } catch { yield* recover; }\n});',
		'Effect.fnUntraced(function* () {\n\ttry { if (ok) { yield* load; } } catch {}\n});'
	])('reports a try around yield* in an Effect generator: %s', (code) => {
		expect(lint(`${effectImport}${code}`)).toEqual([{ messageId: 'tryInGen', line: 3 }]);
	});

	it('resolves an aliased generator factory', () => {
		const code =
			"import { gen as effectGen } from 'effect/Effect';\neffectGen(function* () {\n\ttry { yield* load; } catch {}\n});";
		expect(lint(code)).toEqual([{ messageId: 'tryInGen', line: 3 }]);
	});

	it.each([
		'function* work() {\n\ttry { yield* load; } catch {}\n}\nEffect.gen(work);',
		"const work = function* () {\n\ttry { yield* load; } catch {}\n};\nEffect.fn('work')(work);"
	])('reports a try around yield* in a generator bound to a factory: %s', (code) => {
		expect(lint(`${effectImport}${code}`)).toEqual([{ messageId: 'tryInGen', line: 3 }]);
	});

	it.each([
		'function* plain() {\n\ttry { yield* other(); } catch {}\n}\nrun(plain);',
		'Effect.gen(function* () {\n\ttry { parse(); } catch {}\n\tyield* load;\n});',
		'Effect.gen(function* () {\n\tconst run = () => { try { work(); } catch {} };\n\tyield* load;\n});',
		'function* plain() {\n\ttry { yield* other(); } catch {}\n}',
		'Effect.gen(function* () {\n\tconst inner = function* () { try { yield* other(); } catch {} };\n});',
		'Effect.gen(function* () {\n\ttry { register(function* () { yield* other(); }); } catch {}\n});'
	])('allows try without yield* and plain generators: %s', (code) => {
		expect(lint(`${effectImport}${code}`)).toEqual([]);
	});

	it('checks only the configured files', () => {
		const code = `${effectImport}Effect.gen(function* () {\n\ttry { yield* load; } catch {}\n});`;
		expect(lint(code, 'scripts/tool.ts')).toEqual([]);
	});
});
