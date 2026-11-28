import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { BASE_TABLE } from '../../.agents/skills/upstream-sync/layout/v3.ts';
import { trackedPaths } from '../../.agents/skills/upstream-sync/scripts/apply-layout.ts';
import { WORKSPACE_CHECK_LAYOUT } from '../__fixtures__/static-checks/workspace-layout.ts';
import { apply } from './apply.ts';
import { layoutDifferences } from './checkout-layout.ts';
import { unservedAliases } from './exports.ts';
import { moveScript, ownerProblems, pinProblems, sorted } from './manifests.ts';
import { editedText } from './mapper-steps.ts';
import { outputProblems } from './projects.ts';
import {
	applyEdits,
	REPLACEMENTS,
	replacementProblems,
	staleReplacements
} from './replacements.ts';
import { importsProblems, type Inputs, type KeptAlias, type Manifest } from './run.ts';
import { INPUTS } from './steps.ts';

const checkout = fileURLToPath(new URL('../..', import.meta.url));
const read = (path: string) => readFileSync(join(checkout, path), 'utf8');
const rootManifest = (): Manifest => JSON.parse(read('package.json'));
const flat = { flatPaths: trackedPaths(checkout), table: BASE_TABLE };
const noScript = () => undefined;

describe('ownerProblems', () => {
	it('places every dependency and script of the root manifest', () => {
		expect(ownerProblems(rootManifest())).toEqual([]);
	});

	it('names a root dependency that owners.ts gives no owner', () => {
		const manifest = rootManifest();
		manifest.dependencies = { ...manifest.dependencies, 'left-pad': '1.3.0' };
		expect(ownerProblems(manifest)).toEqual([
			'left-pad is a dependency of the root manifest without an owner in scripts/layout/owners.ts'
		]);
	});

	it('names an owner entry whose dependency the root manifest dropped', () => {
		const manifest = rootManifest();
		const { svix: _dropped, ...dependencies } = manifest.dependencies ?? {};
		manifest.dependencies = dependencies;
		expect(ownerProblems(manifest)).toEqual([
			'scripts/layout/owners.ts names svix, which the root manifest does not declare'
		]);
	});

	it('names a root script that owners.ts gives no owner', () => {
		const manifest = rootManifest();
		manifest.scripts = { ...manifest.scripts, 'check:new': 'bun scripts/new.ts' };
		expect(ownerProblems(manifest)).toEqual([
			'check:new is a script of the root manifest without an owner in scripts/layout/owners.ts'
		]);
	});
});

describe('ownerProblems for sections and replaced scripts', () => {
	it('names a dependency in a section the generator does not place', () => {
		const manifest = rootManifest();
		manifest.optionalDependencies = { fsevents: '2.3.3' };
		expect(ownerProblems(manifest)).toContain(
			'fsevents is a dependency in optionalDependencies of the root manifest, which scripts/layout/manifests.ts does not place'
		);
	});

	it('names a dependency that two sections declare', () => {
		const manifest = rootManifest();
		manifest.devDependencies = { ...manifest.devDependencies, svix: manifest.dependencies!.svix! };
		expect(ownerProblems(manifest)).toContain(
			'svix stands in dependencies and devDependencies of the root manifest'
		);
	});

	it('names a replaced root script whose flat body changed', () => {
		const manifest = rootManifest();
		manifest.scripts = {
			...manifest.scripts,
			postinstall: `${manifest.scripts!.postinstall} && true`
		};
		expect(ownerProblems(manifest)).toEqual([
			'The root script postinstall differs from the flat body its replacement in scripts/layout/owners.ts was written against'
		]);
	});
});

describe('pinProblems', () => {
	it('names a pin of a tracked workspace manifest that differs from the root version', () => {
		const plugin = 'packages/eslint-plugin/package.json';
		const pinned: Manifest = JSON.parse(read(plugin));
		pinned.devDependencies = { ...pinned.devDependencies, vitest: '0.0.1' };
		const run = {
			...flat,
			flatManifest: rootManifest(),
			flatFile: (path: string) => (path === plugin ? JSON.stringify(pinned) : read(path)),
			rewrites: [],
			projectEdges: new Map(),
			inputs: INPUTS
		};
		expect(pinProblems(run)).toEqual([
			`${plugin} pins vitest at 0.0.1, and the root manifest at ${rootManifest().devDependencies!.vitest}`
		]);
		expect(pinProblems({ ...run, flatFile: read })).toEqual([]);
	});
});

describe('importsProblems', () => {
	it('names an exact entry, a conditional value and two overlapping wildcards', () => {
		const imports = {
			'#lib/*': './src/lib/*',
			'#lib/ui/*': './src/ui/*',
			'#exact': './src/exact.ts'
		};
		expect(importsProblems({ imports })).toEqual([
			'The imports entry #exact is no wildcard pair of a directory',
			'The imports entries #lib/* and #lib/ui/* overlap'
		]);
		const conditional = { '#env/*': { node: './node/*', default: './web/*' } };
		expect(importsProblems({ imports: conditional } as unknown as Manifest)).toEqual([
			'The imports entry #env/* has a conditional value'
		]);
	});

	it('reads the flat imports map without a problem', () => {
		expect(importsProblems(rootManifest())).toEqual([]);
	});
});

describe('outputProblems', () => {
	let directory: string | undefined;
	afterEach(() => {
		if (directory) rmSync(directory, { recursive: true, force: true });
		directory = undefined;
	});
	const runOn = (checkout: string, inputs: Inputs) => ({
		...flat,
		checkout,
		flatFile: read,
		inputs
	});

	it('names a project file that a tracked file of other content occupies, and accepts an equal one', () => {
		const path = 'packages/eslint-plugin/bunfig.toml';
		const differs = { ...INPUTS, projectFiles: [{ path, text: 'env = true\n' }] };
		expect(outputProblems(runOn(checkout, differs))).toEqual([
			`${path} is a project file of the generator, and the tracked ${path} lands there with other content`
		]);
		const equal = { ...INPUTS, projectFiles: [{ path, text: read(path) }] };
		expect(outputProblems(runOn(checkout, equal))).toEqual([]);
	});

	it('names an untracked or ignored file at an output path', () => {
		directory = mkdtempSync(join(tmpdir(), 'layout-outputs-'));
		mkdirSync(join(directory, 'apps/web'), { recursive: true });
		writeFileSync(join(directory, 'apps/web/package.json'), '{}');
		expect(outputProblems(runOn(directory, { ...INPUTS, projectFiles: [] }))).toEqual([
			'apps/web/package.json is an output of the move, and an untracked or ignored file holds it'
		]);
	});
});

describe('editedText', () => {
	const text = "import type { A } from '#lib/x.js'; import type { B } from '#lib/x.js';\n";
	const offsets = [...text.matchAll(/'#lib\/x\.js'/g)].map((match) => match.index);

	it('rewrites two equal specifiers on one line, each at its own literal', () => {
		const edits = offsets.map((literalOffset) => ({
			file: 'a.ts',
			literalOffset,
			from: '#lib/x.js',
			to: './x.js'
		}));
		expect(editedText('a.ts', text, edits)).toEqual({
			text: "import type { A } from './x.js'; import type { B } from './x.js';\n",
			problems: []
		});
	});

	it('names a planned rewrite that finds no literal at its offset', () => {
		const edit = { file: 'a.ts', literalOffset: 3, from: '#lib/x.js', to: './x.js' };
		expect(editedText('a.ts', text, [edit]).problems).toEqual([
			'a.ts: no literal #lib/x.js at offset 3'
		]);
	});
});

describe('staleReplacements', () => {
	it('accepts the flat files the replacements were written against', () => {
		expect(staleReplacements(read)).toEqual([]);
	});

	it('names a flat file that changed since its replacement was written', () => {
		expect(
			staleReplacements((path) => (path === 'tsconfig.json' ? `${read(path)}\n` : read(path)))
		).toEqual([
			'tsconfig.json changed since its replacement in scripts/layout/replacements.ts was written; rewrite the replacement against the new file and record its SHA-256'
		]);
	});
});

describe('replacementProblems', () => {
	const projection = { flatFile: read, table: BASE_TABLE, rewrites: [] };

	it('names a literal edit that the projected text does not hold, before any step runs', () => {
		const sha256 = createHash('sha256').update(read('.env-convex.schema')).digest('hex');
		expect(
			replacementProblems(projection, [
				{ from: '.env-convex.schema', sha256, content: [['@absent-directive', '@other']] }
			])
		).toEqual(['packages/backend/.env-convex.schema holds @absent-directive nowhere, not once']);
	});

	it('inserts the replacement text literally', () => {
		expect(applyEdits('file.ts', "const a = 'x';", [["'x'", "'$&$1'"]])).toEqual({
			text: "const a = '$&$1';",
			problems: []
		});
	});
});

describe('the app stylesheet', () => {
	it('imports the tokens of @repo/ui through its export', () => {
		const layout = REPLACEMENTS.find(({ from }) => from === 'src/routes/layout.css');
		const edits =
			typeof layout?.content === 'object' && !('image' in layout.content) ? layout.content : [];
		const { text } = applyEdits(
			'apps/web/src/routes/layout.css',
			read('src/routes/layout.css'),
			edits
		);
		expect(text).toContain("@import '@repo/ui/src/components/ui/tokens.css';");
		expect(text).not.toContain('../lib/components/ui/tokens.css');
	});
});

describe('sorted', () => {
	it('orders keys by code unit, whatever the host collation', () => {
		expect(Object.keys(sorted({ 'ä.ts': '1', 'z.ts': '1', 'a.ts': '1' }))).toEqual([
			'a.ts',
			'z.ts',
			'ä.ts'
		]);
	});
});

describe('layoutDifferences', () => {
	const paths = ['packages/backend/shared/effect/errors.ts', 'apps/web/src/app.html'];

	it('finds no difference between the workspace layout and itself', () => {
		expect(layoutDifferences(WORKSPACE_CHECK_LAYOUT, { ...WORKSPACE_CHECK_LAYOUT }, paths)).toEqual(
			[]
		);
	});

	it('names a written layout whose backend lost a source directory', () => {
		const written = {
			...WORKSPACE_CHECK_LAYOUT,
			owners: {
				...WORKSPACE_CHECK_LAYOUT.owners,
				backend: { ...WORKSPACE_CHECK_LAYOUT.owners.backend, sources: ['confect/'] }
			}
		};
		expect(layoutDifferences(WORKSPACE_CHECK_LAYOUT, written, paths)).toEqual([
			'WORKSPACE_CHECK_LAYOUT.owners.backend.sources.1 is undefined',
			'WORKSPACE_CHECK_LAYOUT.owners.backend.sources.2 is undefined',
			'WORKSPACE_CHECK_LAYOUT.owners.backend.sources.3 is undefined'
		]);
	});
});

describe('unservedAliases', () => {
	const kept: KeptAlias = {
		owner: 'emails',
		prefix: '#lib/',
		specifier: '#lib/emails/templates/types.js',
		flatTarget: 'src/lib/emails/templates/types.ts',
		target: 'packages/emails/src/templates/types.ts'
	};

	it('accepts a kept alias import that an imports entry of its workspace resolves', () => {
		expect(unservedAliases(new Map([['emails', { '#lib/emails/*': './src/*' }]]), [kept])).toEqual(
			[]
		);
	});

	it('names a kept alias import that resolves under no written entry', () => {
		expect(unservedAliases(new Map([['emails', { '#lib/*': './src/*' }]]), [kept])).toEqual([
			'emails: #lib/emails/templates/types.js resolves to packages/emails/src/templates/types.ts under no imports entry'
		]);
	});
});

describe('moveScript', () => {
	it('names a moved path relative to the workspace the script moves to', () => {
		expect(
			moveScript(
				flat,
				'tsc -p src/lib/convex/tsconfig.json --noEmit',
				'backend',
				noScript,
				() => {}
			)
		).toBe('tsc -p convex/tsconfig.json --noEmit');
	});

	it('runs a script that another workspace owns through --filter', () => {
		const owner = (name: string) => (name === 'generate:content' ? 'backend' : 'web');
		expect(
			moveScript(flat, 'bun run generate:content && vitest --run', 'web', owner, () => {})
		).toBe('bun run --filter @repo/backend generate:content && vitest --run');
	});

	it('keeps a script that a --cwd command names in its own workspace', () => {
		expect(
			moveScript(
				flat,
				'bun run --cwd packages/create-saas-starter build',
				'create-saas-starter',
				() => 'web',
				() => {}
			)
		).toBe('bun run build');
	});

	it('reports a path that leaves the workspace', () => {
		const warnings: string[] = [];
		expect(
			moveScript(flat, 'prettier --write src/i18n/*.json', 'web', noScript, (line) =>
				warnings.push(line)
			)
		).toBe('prettier --write ../../packages/product-config/src/i18n/*.json');
		expect(warnings).toEqual([
			'web script reads ../../packages/product-config/src/i18n/*.json outside its workspace'
		]);
	});
});

describe('moveScript refusals', () => {
	const owner = (name: string) => (name === 'generate:content' ? 'backend' : 'web');
	const move = (body: string) => () => moveScript(flat, body, 'web', owner, () => {});

	it('leaves text in a quoted argument of another command', () => {
		expect(move("printf '%s' 'bun run generate:content'")()).toBe(
			"printf '%s' 'bun run generate:content'"
		);
	});

	it('stops on a quoted script name, a quoted path, a deleted path and a glob of two owners', () => {
		expect(move('bun run "generate:content"')).toThrow(
			'It runs the quoted script name "generate:content"'
		);
		expect(move('tsc -p "src/lib/convex/tsconfig.json"')).toThrow(
			'It names the quoted path src/lib/convex/tsconfig.json'
		);
		expect(move('bun scripts/layout/apply.ts')).toThrow(
			'It names scripts/layout/apply.ts, which the move deletes'
		);
		expect(move('prettier --check src/**/*.ts')).toThrow(
			'It names src/**/*.ts, whose files the move sends to more than one place'
		);
	});
});

describe('apply on an invented flat tree', () => {
	let directory: string | undefined;
	afterEach(() => {
		if (directory) rmSync(directory, { recursive: true, force: true });
		directory = undefined;
	});
	const inputs: Inputs = {
		owners: { dependencies: {}, peers: {}, scripts: {}, newScripts: {}, replacedRootScripts: {} },
		projectFiles: [],
		replacements: [],
		repositoryChecks: false
	};
	const flatTree = (files: Record<string, string>) => {
		directory = mkdtempSync(join(tmpdir(), 'layout-apply-'));
		const git = (...args: string[]) =>
			spawnSync('git', args, { cwd: directory, encoding: 'utf8' }).status;
		expect(git('init', '--quiet')).toBe(0);
		for (const [path, text] of Object.entries(files)) {
			mkdirSync(dirname(join(directory, path)), { recursive: true });
			writeFileSync(join(directory, path), text);
		}
		expect(git('add', '--all')).toBe(0);
		expect(git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'flat')).toBe(0);
		return directory;
	};
	const tree = {
		'package.json': `${JSON.stringify({ name: 'fixture', imports: { '#lib/*': './src/lib/*' } })}\n`,
		'.prettierrc': `${JSON.stringify({ useTabs: true, singleQuote: true, printWidth: 100 })}\n`,
		'src/lib/chat/core/types.ts': 'export type A = 1;\nexport type B = 2;\n',
		'src/lib/layout-review/index.js/index.ts': 'export const x = 1;\n',
		'src/routes/page.ts': [
			"import type { A } from '#lib/chat/core/types.js'; import type { B } from '#lib/chat/core/types.js';",
			"import { x } from '#lib/layout-review/index.js/index.js';",
			''
		].join('\n')
	};

	it('moves the tree, rewrites both equal specifiers of a line, formats it and writes one entry per target', async () => {
		const root = flatTree(tree);
		await apply(root, () => {}, inputs);
		const at = (path: string) => readFileSync(join(root, path), 'utf8');
		expect(at('apps/web/src/routes/page.ts')).toBe(
			[
				"import type { A } from '@repo/backend/shared/chat/core/types.ts';",
				"import type { B } from '@repo/backend/shared/chat/core/types.ts';",
				"import { x } from '#lib/layout-review/index.js/index.js';",
				''
			].join('\n')
		);
		expect(JSON.parse(at('apps/web/package.json'))).toMatchObject({
			imports: { '#lib/*': './src/lib/*' },
			dependencies: { '@repo/backend': 'workspace:*' }
		});
		expect(JSON.parse(at('packages/backend/package.json')).exports).toEqual({
			'./shared/chat/core/types.ts': './shared/chat/core/types.ts'
		});
	});

	it('stops before the move on an ignored file at an output path', async () => {
		const root = flatTree(tree);
		writeFileSync(join(root, '.git/info/exclude'), 'apps/\n');
		mkdirSync(join(root, 'apps/web'), { recursive: true });
		writeFileSync(join(root, 'apps/web/package.json'), '{"description":"marker"}\n');
		await expect(apply(root, () => {}, inputs)).rejects.toThrow(
			'apps/web/package.json is an output of the move, and an untracked or ignored file holds it'
		);
		expect(readFileSync(join(root, 'src/routes/page.ts'), 'utf8')).toBe(tree['src/routes/page.ts']);
	});
});

describe('apply', () => {
	let directory: string | undefined;
	afterEach(() => {
		if (directory) rmSync(directory, { recursive: true, force: true });
		directory = undefined;
	});

	it('refuses a checkout with uncommitted changes and leaves it as it was', async () => {
		directory = mkdtempSync(join(tmpdir(), 'layout-apply-'));
		const git = (...args: string[]) =>
			spawnSync('git', args, { cwd: directory, encoding: 'utf8' }).status;
		expect(git('init', '--quiet')).toBe(0);
		writeFileSync(join(directory, 'package.json'), '{}\n');
		expect(git('add', 'package.json')).toBe(0);
		expect(git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'flat')).toBe(0);
		writeFileSync(join(directory, 'stray.ts'), '');
		await expect(apply(directory, () => {})).rejects.toThrow(
			'The checkout has uncommitted changes:\n?? stray.ts'
		);
		expect(readFileSync(join(directory, 'package.json'), 'utf8')).toBe('{}\n');
	});
});
