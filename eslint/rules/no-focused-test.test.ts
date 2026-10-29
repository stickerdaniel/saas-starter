import { ESLint, Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import { parser } from 'typescript-eslint';
import rule from './no-focused-test.js';

function reports(code: string) {
	const linter = new Linter();
	return linter
		.verify(
			code,
			[
				{
					files: ['**/*.ts'],
					languageOptions: { parser, sourceType: 'module' },
					plugins: { local: { rules: { 'no-focused-test': rule } } },
					rules: { 'local/no-focused-test': 'error' }
				}
			],
			{ filename: 'example.test.ts' }
		)
		.map(({ line, column, ruleId }) => ({ line, column, ruleId }));
}

const focused = (line: number, column: number) => ({
	line,
	column,
	ruleId: 'local/no-focused-test'
});

describe('no-focused-test', () => {
	it.each([
		"it.only('case', () => {});",
		"test.only('case', () => {});",
		"describe.only('suite', () => {});",
		"suite.only('suite', () => {});",
		"it.concurrent.only('case', () => {});",
		"describe.sequential.only('suite', () => {});",
		"it.only.each([1])('case %s', () => {});",
		"test.describe.only('suite', () => {});",
		"test.describe.serial.only('suite', () => {});",
		"test.describe.parallel.only('suite', () => {});",
		"it['only']('case', () => {});"
	])('reports %s', (code) => {
		expect(reports(code)).toEqual([focused(1, code.search(/'?only/) + 1)]);
	});

	it('reports a runner imported under another name', () => {
		const code = `import { test as setup } from '@playwright/test';\nsetup.only('signs in', async () => {});`;
		expect(reports(code)).toEqual([focused(2, 7)]);
	});

	it('reports a Playwright fixture extended from test', () => {
		const code = `const test = base.extend({ value: 1 });\ntest.only('case', () => {});`;
		expect(reports(code)).toEqual([focused(2, 6)]);
	});

	it.each([
		"it('case', () => {});",
		"it.skip('case', () => {});",
		"test.describe('suite', () => {});",
		"test.describe.configure({ mode: 'serial' });",
		'const options = { only: true };\nif (options.only) run();',
		"expect(value).only;\nfixture.only('case');",
		"const name = 'only';\ntest[name]('case', () => {});"
	])('allows %s', (code) => {
		expect(reports(code)).toEqual([]);
	});
});

// The repository config decides where the rule runs: every unit and E2E test file.
describe('no-focused-test repository coverage', () => {
	const eslint = new ESLint();
	const source = `import { it } from 'vitest';\nit.only('case', () => {});\n`;

	async function ruleMessages(filePath: string) {
		const [result] = await eslint.lintText(source, { filePath });
		expect(result.messages.filter((message) => message.fatal)).toEqual([]);
		return result.messages.filter((message) => message.ruleId === 'local/no-focused-test');
	}

	it.each([
		'scripts/example.test.ts',
		'src/lib/example.spec.ts',
		'src/lib/convex/example.test.ts',
		'packages/create-saas-starter/test/example.test.ts',
		'e2e/example.spec.ts',
		'e2e/auth.setup.ts'
	])(
		'reaches %s',
		async (filePath) => {
			const messages = await ruleMessages(filePath);
			expect(messages).toHaveLength(1);
			expect(messages[0].severity).toBe(2);
		},
		60_000
	);

	it('leaves non-test modules alone', async () => {
		expect(await ruleMessages('scripts/example.ts')).toEqual([]);
	}, 60_000);
});
