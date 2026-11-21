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
					rules: {
						'local/no-source-text-read': [
							'error',
							{
								roots: ['src', 'scripts'],
								contracts: [
									'scripts/x.contract.test.ts',
									'src/lib/feature/__tests__/inventory.contract.test.ts'
								],
								helpers: [
									{ module: 'src/lib/test-utils/source-scanner.ts', names: ['readSources'] }
								]
							}
						]
					}
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
					"Import the module behind `src/lib/convex/users.ts` and test its behaviour; a test that reads production source as text passes while behaviour breaks. The one exemption is a two-sided contract that reads both producer and consumer, rejects a planted corruption, and is listed in this rule's `contracts` option in `eslint.config.js`; a human approves each new entry."
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

	it.each([
		['a $lib ?raw import', `import source from '$lib/convex/users.ts?raw';`],
		['a #lib ?raw import', `import source from '#lib/convex/users.ts?raw';`],
		[
			'a dynamic $lib ?raw import',
			`const { default: source } = await import('$lib/convex/users.ts?raw');`
		],
		[
			'a $lib raw glob',
			`import.meta.glob('$lib/convex/*.ts', { query: '?raw', import: 'default' });`
		]
	])('resolves %s through the alias', (_kind, code) => {
		expect(reports(code).map(({ messageId }) => messageId)).toEqual(['sourceTextRead']);
	});

	it.each([
		[
			'destructuring',
			`const { readFileSync } = await import('node:fs');\nreadFileSync('src/lib/convex/users.ts', 'utf8');`
		],
		[
			'a module binding',
			`const fs = await import('node:fs');\nfs.readFileSync('src/lib/convex/users.ts', 'utf8');`
		],
		[
			'an awaited module',
			`(await import('node:fs/promises')).readFile('src/lib/convex/users.ts', 'utf8');`
		],
		[
			'a then callback',
			`import('node:fs').then(({ readFileSync }) => readFileSync('src/lib/convex/users.ts', 'utf8'));`
		]
	])('reports a dynamic node:fs import read through %s', (_kind, code) => {
		expect(reports(code).map(({ messageId }) => messageId)).toEqual(['sourceTextRead']);
		expect(reports(code.replace('src/lib/convex/users.ts', 'package.json'))).toEqual([]);
	});

	it.each([
		[
			'destructuring from a namespace import',
			`import * as fs from 'node:fs';\nconst { readFileSync } = fs;\nreadFileSync('src/lib/convex/users.ts', 'utf8');`
		],
		[
			'a const bound to a namespace member',
			`import * as fs from 'node:fs';\nconst read = fs.readFileSync;\nread('src/lib/convex/users.ts', 'utf8');`
		],
		[
			'a const bound to Bun.file',
			`const read = Bun.file;\nawait read('src/lib/convex/users.ts').text();`
		],
		[
			'an alias of an alias',
			`import { readFileSync } from 'node:fs';\nconst read = readFileSync;\nconst load = read;\nload('src/lib/convex/users.ts', 'utf8');`
		],
		[
			'promises destructured from a namespace import',
			`import * as fs from 'node:fs';\nconst { promises } = fs;\nawait promises.readFile('src/lib/convex/users.ts', 'utf8');`
		],
		[
			'nested destructuring from a namespace import',
			`import * as fs from 'node:fs';\nconst { promises: { readFile } } = fs;\nawait readFile('src/lib/convex/users.ts', 'utf8');`
		],
		[
			'nested destructuring from a default import',
			`import fs from 'node:fs';\nconst { promises: { readFile: read } } = fs;\nawait read('src/lib/convex/users.ts', 'utf8');`
		],
		[
			'nested destructuring of an awaited import',
			`const { promises: { readFile } } = await import('node:fs');\nawait readFile('src/lib/convex/users.ts', 'utf8');`
		],
		[
			'nested destructuring in a then callback',
			`import('node:fs').then(({ promises: { readFile } }) => readFile('src/lib/convex/users.ts', 'utf8'));`
		]
	])('reports a reader reached through %s', (_kind, code) => {
		expect(reports(code).map(({ messageId }) => messageId)).toEqual(['sourceTextRead']);
		expect(reports(code.replace('src/lib/convex/users.ts', 'package.json'))).toEqual([]);
	});

	it('skips exactly the files the contracts option lists', () => {
		const code = `${fsImport}readFileSync('src/lib/convex/users.ts', 'utf8');`;
		expect(reports(code, 'scripts/x.contract.test.ts')).toEqual([]);
		expect(reports(code, 'scripts/y.contract.test.ts')).toEqual([
			expect.objectContaining({ line: 2, messageId: 'sourceTextRead' })
		]);
	});

	describe('a helper that returns source text', () => {
		const helperTest = 'src/lib/feature/__tests__/inventory.test.ts';
		const assertion = `\nconst rows = readSources();\nexpect(rows[0].text).toContain('requireAdmin');`;

		it.each([
			[
				'a relative import',
				`import { readSources } from '../../test-utils/source-scanner';${assertion}`
			],
			[
				'an aliased import with its extension',
				`import { readSources } from '#lib/test-utils/source-scanner.ts';${assertion}`
			],
			[
				'a renamed import',
				`import { readSources as sources } from '$lib/test-utils/source-scanner';\nexpect(sources()[0].text).toContain('requireAdmin');`
			]
		])('reports %s in an ordinary test', (_kind, code) => {
			expect(reports(code, helperTest)).toEqual([
				expect.objectContaining({
					line: 1,
					messageId: 'sourceTextHelper',
					message: expect.stringContaining('`readSources`')
				})
			]);
		});

		it('reports a call through a namespace import', () => {
			const code = `import * as scanner from '../../test-utils/source-scanner';\nexpect(scanner.readSources()[0].text).toContain('requireAdmin');`;
			expect(reports(code, helperTest)).toEqual([
				expect.objectContaining({ line: 2, messageId: 'sourceTextHelper' })
			]);
		});

		it.each([
			[
				'destructuring from a namespace import',
				`import * as scan from '../../test-utils/source-scanner';\nconst { readSources } = scan;\nexpect(readSources()[0].text).toContain('requireAdmin');`,
				2
			],
			[
				'a member of a dynamic import',
				`const scan = await import('../../test-utils/source-scanner');\nexpect(scan.readSources()[0].text).toContain('requireAdmin');`,
				2
			],
			[
				'destructuring from a dynamic import',
				`const { readSources } = await import('#lib/test-utils/source-scanner.ts');\nexpect(readSources()[0].text).toContain('requireAdmin');`,
				1
			],
			[
				'a member of an awaited dynamic import',
				`expect((await import('$lib/test-utils/source-scanner')).readSources()[0].text).toContain('requireAdmin');`,
				1
			],
			[
				'a dynamic import handed to then',
				`import('../../test-utils/source-scanner').then(({ readSources }) => readSources());`,
				1
			],
			[
				'a namespace the rule cannot follow',
				`import * as scan from '../../test-utils/source-scanner';\ninspect(scan);`,
				2
			]
		])('reports %s', (_kind, code, line) => {
			expect(reports(code, helperTest)).toEqual([
				expect.objectContaining({ line, messageId: 'sourceTextHelper' })
			]);
		});

		it("allows the helper in a listed contract and the module's other exports anywhere", () => {
			const code = `import { readSources } from '../../test-utils/source-scanner';${assertion}`;
			expect(reports(code, 'src/lib/feature/__tests__/inventory.contract.test.ts')).toEqual([]);
			expect(reports(code, 'src/lib/feature/__tests__/other.contract.test.ts')).toEqual([
				expect.objectContaining({ line: 1, messageId: 'sourceTextHelper' })
			]);
			expect(
				reports(
					`import { scanSources } from '../../test-utils/source-scanner';\nscanSources([]);`,
					helperTest
				)
			).toEqual([]);
			expect(
				reports(
					`const { scanSources } = await import('../../test-utils/source-scanner');\nscanSources([]);`,
					helperTest
				)
			).toEqual([]);
		});
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
			'a readFile destructured from an object that is not node:fs',
			`const { promises: { readFile } } = { promises: { readFile: (p: string) => p } };\nreadFile('src/lib/convex/users.ts');`
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
		'scripts/example.spec.cts',
		'src/lib/convex/example.contract.test.ts',
		'src/lib/components/example.contract.dom.svelte.test.ts'
	])(
		'reaches %s',
		async (filePath) => {
			const messages = await ruleMessages(filePath);
			expect(messages).toHaveLength(1);
			expect(messages[0].severity).toBe(2);
		},
		60_000
	);

	it.each(['scripts/avatar-inline-route.contract.test.ts', 'src/lib/convex/example.ts'])(
		'leaves %s alone',
		async (filePath) => {
			expect(await ruleMessages(filePath)).toEqual([]);
		},
		60_000
	);
});
