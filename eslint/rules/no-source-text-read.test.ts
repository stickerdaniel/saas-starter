import path from 'node:path';
import { ESLint, Linter } from 'eslint';
import globals from 'globals';
import { describe, expect, it } from 'vitest';
import { parser } from 'typescript-eslint';
import rule from './no-source-text-read.js';

const repoRoot = path.resolve(import.meta.dirname, '../..');

/** Lints `code` as the test file at `testFile`, relative to the repository root. */
function reports(code: string, testFile = 'src/lib/example.test.ts') {
	const linter = new Linter({ cwd: repoRoot });
	return linter
		.verify(
			code,
			[
				{
					files: ['**/*.ts'],
					// The repository config declares these, which binds `URL` and `__dirname` in scope.
					languageOptions: { parser, globals: { ...globals.browser, ...globals.node } },
					plugins: { local: { rules: { 'no-source-text-read': rule } } },
					rules: { 'local/no-source-text-read': ['error', { roots: ['src', 'scripts'] }] }
				}
			],
			{ filename: path.join(repoRoot, testFile) }
		)
		.map(({ line, messageId, message }) => ({ line, messageId, message }));
}

const fsImport = "import { readFileSync } from 'node:fs';\n";

describe('no-source-text-read', () => {
	it('reports a literal path read and names the file in the message', () => {
		expect(
			reports(`${fsImport}const source = readFileSync('src/lib/convex/users.ts', 'utf8');`)
		).toEqual([
			{
				line: 2,
				messageId: 'sourceTextRead',
				message:
					'Import the module behind `src/lib/convex/users.ts` and test its behaviour; a test that reads production source as text passes while behaviour breaks. A two-sided contract that reads both producer and consumer and rejects a planted corruption belongs in a `*.contract.test.ts` file.'
			}
		]);
	});

	it.each([
		[
			'a same-file arrow wrapper',
			`${fsImport}const read = (p: string) => readFileSync(p, 'utf8');\nread('src/lib/convex/users.ts');`
		],
		[
			'a function wrapper that joins its parameter to a root',
			`${fsImport}import path from 'node:path';\nconst ROOT = path.resolve(import.meta.dirname, '../..');\nfunction read(relative: string) {\n\treturn readFileSync(path.join(ROOT, relative), 'utf8');\n}\nread('src/hooks.server.ts');`
		],
		[
			'a template literal of constants',
			`${fsImport}const ROOT = 'src/lib';\nconst FILE = 'convex/users.ts';\nreadFileSync(\`\${ROOT}/\${FILE}\`);`
		],
		['Bun.file', `Bun.file('src/hooks.server.ts');`],
		['the fs namespace', `import * as fs from 'node:fs';\nfs.readFileSync('src/hooks.server.ts');`],
		[
			'fs.promises.readFile',
			`import fs from 'node:fs';\nawait fs.promises.readFile('src/hooks.server.ts', 'utf8');`
		],
		[
			'readFile from fs/promises',
			`import { readFile } from 'node:fs/promises';\nawait readFile('src/routes/+layout.svelte', 'utf8');`
		],
		[
			'path.resolve from the working directory',
			`import * as fs from 'node:fs';\nimport * as path from 'node:path';\nfs.readFileSync(path.resolve('src/lib/server/cache-control.ts'), 'utf-8');`
		],
		[
			'__dirname as a base',
			`${fsImport}import { join } from 'node:path';\nreadFileSync(join(__dirname, '../hooks.server.ts'), 'utf8');`
		],
		[
			'process.cwd() as a base',
			`${fsImport}import { join } from 'node:path';\nreadFileSync(join(process.cwd(), 'scripts/static-checks.ts'), 'utf8');`
		],
		[
			'a raw import.meta.glob',
			`import.meta.glob('../convex/*.ts', { query: '?raw', import: 'default' });`
		],
		['a legacy raw import.meta.glob', `import.meta.glob('/src/lib/convex/*.ts', { as: 'raw' });`]
	])('reports a read through %s', (_kind, code) => {
		expect(reports(code).map(({ messageId }) => messageId)).toEqual(['sourceTextRead']);
	});

	it.each([
		[
			'a type assertion on the path',
			`${fsImport}readFileSync(<string>'src/hooks.server.ts', 'utf8');`
		],
		['a non-null reader', `${fsImport}readFileSync!('src/hooks.server.ts', 'utf8');`],
		[
			'a non-null module owner',
			`import * as fs from 'node:fs';\nfs!.readFileSync('src/hooks.server.ts', 'utf8');`
		],
		[
			'an asserted module owner',
			`import * as fs from 'node:fs';\n(fs as typeof fs).readFileSync('src/hooks.server.ts', 'utf8');`
		],
		[
			'a wrapper whose initializer is wrapped in satisfies',
			`${fsImport}const read = ((p: string) => readFileSync(p, 'utf8')) satisfies (p: string) => string;\nread('src/hooks.server.ts');`
		],
		[
			'an instantiated wrapper',
			`${fsImport}const read = <T extends string>(p: T) => readFileSync(p, 'utf8');\n(read<string>)('src/hooks.server.ts');`
		]
	])('reports %s', (_kind, code) => {
		expect(reports(code)).toEqual([
			expect.objectContaining({ line: code.split('\n').length, messageId: 'sourceTextRead' })
		]);
	});

	it('reports the call to a wrapper on the line of the call', () => {
		const code = `${fsImport}const read = (p: string) => readFileSync(p, 'utf8');\n\nread('src/lib/convex/users.ts');`;
		expect(reports(code).map(({ line }) => line)).toEqual([4]);
	});

	it.each([
		['new URL', `readFileSync(new URL('../src/hooks.server.ts', import.meta.url), 'utf8');`],
		[
			'fileURLToPath of new URL',
			`import { fileURLToPath } from 'node:url';\nreadFileSync(fileURLToPath(new URL('../src/hooks.server.ts', import.meta.url)), 'utf8');`
		]
	])('resolves %s against the test file', (_kind, code) => {
		expect(
			reports(`${fsImport}${code}`, 'scripts/x.test.ts').map(({ messageId }) => messageId)
		).toEqual(['sourceTextRead']);
		// The same URL from one directory deeper points outside the roots.
		expect(reports(`${fsImport}${code}`, 'eslint/rules/x.test.ts')).toEqual([]);
	});

	it('resolves a ?raw import against the test file', () => {
		expect(reports(`import source from '../hooks.server.ts?raw';`, 'src/lib/x.test.ts')).toEqual([
			expect.objectContaining({ line: 1, messageId: 'sourceTextRead' })
		]);
	});

	it('skips a two-sided contract file', () => {
		const code = `${fsImport}readFileSync('src/lib/convex/users.ts', 'utf8');`;
		expect(reports(code, 'scripts/x.contract.test.ts')).toEqual([]);
	});

	it.each([
		['a fixture directory', 'scripts/__fixtures__/static-checks/private-checkout.ts'],
		['a test file', 'src/lib/convex/users.test.ts'],
		['a __tests__ directory', 'src/lib/convex/aiChat/__tests__/helpers.ts'],
		['a test-fixtures directory', 'src/lib/test-fixtures/users.ts'],
		['generated output', 'src/lib/i18n/static-translations.generated.ts'],
		['a committed bundle', 'scripts/english-policy/pr-metadata.bundle.mjs'],
		['a file outside the roots', 'eslint/rules/no-test-in-loop.js'],
		['a non-code file under a root', 'src/app.html']
	])('allows reading %s', (_kind, target) => {
		expect(reports(`${fsImport}readFileSync('${target}', 'utf8');`)).toEqual([]);
	});

	it.each([
		[
			'a tmpdir path',
			`${fsImport}import { tmpdir } from 'node:os';\nimport { join } from 'node:path';\nreadFileSync(join(tmpdir(), 'src/lib/convex/users.ts'), 'utf8');`
		],
		['a CLI entry handed to a spawn', `Bun.spawn(['bun', 'scripts/static-checks.ts']);`],
		['a path given to a non-reader call', `ROUTES['authored-prose']('src/lib/x.svelte');`],
		[
			'a dynamic path',
			`${fsImport}for (const file of files) readFileSync(\`src/\${file}\`, 'utf8');`
		],
		[
			'a let binding',
			`${fsImport}let file = 'src/lib/convex/users.ts';\nreadFileSync(file, 'utf8');`
		],
		[
			'a local readFileSync',
			`const readFileSync = (p: string) => p;\nreadFileSync('src/lib/convex/users.ts');`
		],
		[
			'a nested reader whose parameter shadows the wrapper parameter',
			`${fsImport}const read = (p: string) => {\n\tconst inner = (p: string) => readFileSync(p, 'utf8');\n\treturn inner('package.json');\n};\nread('src/hooks.server.ts');`
		],
		[
			'a path under a fixture context cwd',
			`${fsImport}import { join } from 'node:path';\nconst load = (context: { cwd: string }) => readFileSync(join(context.cwd, 'src/hooks.server.ts'), 'utf8');\nload({ cwd: '/tmp/fixture' });`
		],
		[
			'a wrapper that ignores its parameter for the path',
			`${fsImport}const read = (label: string) => readFileSync('package.json', 'utf8') + label;\nread('src/lib/convex/users.ts');`
		]
	])('allows %s', (_kind, code) => {
		expect(reports(code)).toEqual([]);
	});
});

// The repository config decides which test files the rule reaches.
describe('no-source-text-read repository coverage', () => {
	const eslint = new ESLint();
	const source = `import { readFileSync } from 'node:fs';\nexport const text = readFileSync('src/lib/convex/users.ts', 'utf8');\n`;

	async function ruleMessages(filePath: string) {
		const [result] = await eslint.lintText(source, { filePath });
		expect(result.messages.filter((message) => message.fatal)).toEqual([]);
		return result.messages.filter((message) => message.ruleId === 'local/no-source-text-read');
	}

	it.each([
		'src/lib/convex/example.test.ts',
		'src/routes/example.svelte.test.ts',
		'e2e/example.spec.ts',
		'scripts/example.test.mts',
		'scripts/example.spec.cts'
	])(
		'reaches %s',
		async (filePath) => {
			const messages = await ruleMessages(filePath);
			expect(messages).toHaveLength(1);
			expect(messages[0].severity).toBe(2);
		},
		60_000
	);

	it.each(['src/lib/convex/example.contract.test.ts', 'src/lib/convex/example.ts'])(
		'leaves %s alone',
		async (filePath) => {
			expect(await ruleMessages(filePath)).toEqual([]);
		},
		60_000
	);
});
