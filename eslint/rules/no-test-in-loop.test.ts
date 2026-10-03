import { ESLint, Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import { parser } from 'typescript-eslint';
import rule from './no-test-in-loop.js';

function lint(code: string) {
	const linter = new Linter();
	return linter.verify(
		code,
		[
			{
				files: ['**/*.ts'],
				languageOptions: { parser },
				plugins: { local: { rules: { 'no-test-in-loop': rule } } },
				rules: { 'local/no-test-in-loop': 'error' }
			}
		],
		{ filename: 'example.test.ts' }
	);
}

function reports(code: string) {
	return lint(code).map(({ line, message, ruleId }) => ({ line, message, ruleId }));
}

const testMessage = (root: string) =>
	`Declare parameterized tests with \`${root}.each(cases)('name %s', ...)\` instead of calling \`${root}\` inside a loop; build the case list with the loop if needed.`;
const suiteMessage = (root: string) =>
	`Declare parameterized suites with \`${root}.each(cases)('name %s', ...)\` instead of calling \`${root}\` inside a loop; build the case list with the loop if needed.`;
const at = (line: number, message: string) => ({
	line,
	message,
	ruleId: 'local/no-test-in-loop'
});

describe('no-test-in-loop', () => {
	it.each([
		['for...of', 'for (const value of values) {'],
		['for await...of', 'for await (const value of values) {'],
		['for...in', 'for (const key in record) {'],
		['for', 'for (let index = 0; index < 2; index++) {']
	])('reports a test declared inside a %s loop', (_kind, header) => {
		expect(reports(`${header}\n\tit('case', () => {});\n}`)).toEqual([at(2, testMessage('it'))]);
	});

	it.each([
		['it', testMessage('it')],
		['test', testMessage('test')],
		['describe', suiteMessage('describe')],
		['suite', suiteMessage('suite')]
	])('reports %s with a message naming its parameterized form', (root, message) => {
		expect(reports(`for (const value of values) ${root}('case', () => {});`)).toEqual([
			at(1, message)
		]);
	});

	it.each([
		'test.only',
		'test.skip',
		'test.todo',
		'test.concurrent',
		'test.sequential',
		'test.fails',
		'describe.shuffle',
		'test.concurrent.only',
		'test.skipIf(ci)',
		'test.runIf(ci)',
		'test.skipIf(ci).only',
		'test.each(rows)',
		'test.for(rows)',
		'describe.skipIf(ci).each(rows)',
		'test.each`a | b`'
	])('reports the terminal call of %s once', (chain) => {
		const root = chain.slice(0, chain.indexOf('.'));
		const message = root === 'describe' ? suiteMessage(root) : testMessage(root);
		expect(reports(`for (const value of values) {\n\t${chain}('case', () => {});\n}`)).toEqual([
			at(2, message)
		]);
	});

	it('reports only the outer describe when a loop wraps a suite', () => {
		const code = `for (const value of values) {
	describe('suite', () => {
		it('case', () => {});
	});
}`;
		expect(reports(code)).toEqual([at(2, suiteMessage('describe'))]);
	});

	it('reports a separate loop inside a describe callback on its own', () => {
		const code = `describe('suite', () => {
	for (const value of values) {
		it('case', () => {});
	}
});`;
		expect(reports(code)).toEqual([at(3, testMessage('it'))]);
	});

	it('allows a loop inside a test body', () => {
		const code = `it('case', () => {
	for (const value of values) {
		expect(value).toBe(true);
	}
});`;
		expect(reports(code)).toEqual([]);
	});

	it('allows top-level parameterized declarations and a loop that builds their cases', () => {
		const code = `const cases = [];
for (const value of values) cases.push([value.name, value]);
it.each(cases)('%s', (_name, value) => {});
test.for(cases)('%s', ([_name, value]) => {});
describe.each\`a | b\`('suite', () => {});`;
		expect(reports(code)).toEqual([]);
	});

	it('allows declarations in a loop header that runs once', () => {
		expect(reports(`for (const value of describe.each(rows)) {}`)).toEqual([]);
	});

	it.each([
		'test.extend({ value: 1 })',
		'test.override({ value: 1 })',
		'test.beforeEach(() => {})',
		'test.afterEach(() => {})',
		'test.beforeAll(() => {})',
		'test.afterAll(() => {})',
		'test.scoped({ value: 1 })',
		'beforeEach(() => {})',
		'expect(value).toBe(true)'
	])('allows %s inside a loop', (call) => {
		expect(reports(`for (const value of values) {\n\t${call};\n}`)).toEqual([]);
	});

	// Out of scope by design: only for-loop forms carry the pattern in practice.
	it.each([
		['while', "while (more()) {\n\tit('case', () => {});\n}"],
		['do...while', "do {\n\tit('case', () => {});\n} while (more());"],
		['forEach', "values.forEach((value) => {\n\tit('case', () => {});\n});"]
	])('does not report a %s loop', (_kind, code) => {
		expect(reports(code)).toEqual([]);
	});

	it('skips files that import node:test, which has no .each', () => {
		const code = `import { it } from 'node:test';
for (const value of values) it('case', () => {});`;
		expect(reports(code)).toEqual([]);
	});

	it('still reports files that import Playwright', () => {
		const code = `import { test } from '@playwright/test';
for (const value of values) test('case', () => {});`;
		expect(reports(code)).toEqual([at(2, testMessage('test'))]);
	});
});

// The repository config decides where the rule runs. Playwright has no `.each`
// and its docs parameterize with loops, so e2e specs stay exempt.
describe('no-test-in-loop repository coverage', () => {
	const eslint = new ESLint();
	const source = `import { it } from 'vitest';\nfor (const value of [1]) it(String(value), () => {});\n`;

	async function ruleMessages(filePath: string) {
		const [result] = await eslint.lintText(source, { filePath });
		expect(result.messages.filter((message) => message.fatal)).toEqual([]);
		return result.messages.filter((message) => message.ruleId === 'local/no-test-in-loop');
	}

	it.each([
		'scripts/example.test.ts',
		'src/lib/example.spec.ts',
		'packages/create-saas-starter/test/example.test.ts',
		'.agents/skills/upstream-sync/scripts/example.test.ts'
	])(
		'reaches %s',
		async (filePath) => {
			const messages = await ruleMessages(filePath);
			expect(messages).toHaveLength(1);
			expect(messages[0].severity).toBe(2);
		},
		60_000
	);

	it.each(['e2e/example.spec.ts', 'scripts/example.ts'])(
		'leaves %s alone',
		async (filePath) => {
			expect(await ruleMessages(filePath)).toEqual([]);
		},
		60_000
	);
});
