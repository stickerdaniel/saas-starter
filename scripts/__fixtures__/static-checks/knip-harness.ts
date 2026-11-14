import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { sanitizedGitEnv } from '../../git-context';
import { withSvelteKitSyncLockSync } from '../../svelte-kit-sync-lock';
import { testExecutable } from '../../test-executable';
import { linkDependencies } from './private-checkout';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const BUN = testExecutable('bun');
export const KNIP: CommandInvocation = { command: 'bun', args: ['knip', '--no-progress'] };
export const CLI_KNIP: CommandInvocation = {
	command: 'bun',
	args: ['run', '--cwd', 'packages/create-saas-starter', 'knip', '--no-progress']
};
export const CLI_TYPES: CommandInvocation = { command: 'bun', args: ['run', 'check:cli'] };
export const APP_TYPES: CommandInvocation = {
	command: 'bun',
	args: ['svelte-check', '--tsconfig', './tsconfig.json', '--tsgo-experimental-api']
};
export const CONVEX_TYPES: CommandInvocation = { command: 'bun', args: ['run', 'check:convex'] };
export const PRETTIER_README: CommandInvocation = {
	command: 'bun',
	args: ['prettier', '--check', '--ignore-unknown', '--', 'README.md']
};
const RECORDER_SOURCE = path.join(
	ROOT,
	'scripts',
	'__fixtures__',
	'static-checks',
	'command-recorder.ts'
);
// The checker template takes `scripts` and the checker dependencies outside it from the worktree
// index. Without them, a clone would run the committed version, or miss a module the checker
// imports, while the worktree already uses a modified policy.
const OVERLAY_PATHSPECS = [
	'scripts',
	'eslint/control-character-policy.js',
	'knowledge-policy.config.ts',
	'src/lib/content/legal-metadata.ts',
	'src/lib/i18n/language-codes.generated.js',
	'tsconfig.json'
];
// Sources required to keep a clone run from passing without seeing the change under test.
const REQUIRED_SOURCES = [
	'scripts/static-checks.ts',
	'scripts/template-setup.ts',
	'src/lib/content/legal-metadata.ts',
	'scripts/terminal-output.ts',
	'scripts/convex-consumer-compat.ts',
	'scripts/english-policy/content.ts',
	'eslint/control-character-policy.js',
	'knowledge-policy.config.ts',
	'src/lib/i18n/language-codes.generated.js'
];
// Tracked files the checker reads beyond its own sources, or that the cases stage and name: the
// line-ending and ignore rules, the manifest, the other type project configs, the page template
// the SvelteKit seed sync requires, and the modules and asset the type, rename, and deletion
// cases remove.
const CHECKER_TEMPLATE_FILES = [
	'.gitattributes',
	'.gitignore',
	'.prettierignore',
	'package.json',
	'.agents/skills/tsconfig.json',
	'src/lib/convex/tsconfig.json',
	'src/app.html',
	'src/lib/billing/checkout-result.ts',
	'src/lib/convex/constants.ts',
	'static/favicon.ico'
];
// Stand-ins for the application and documentation corpus. Full-project runs scan every
// Markdown file, and the real README links documents the template leaves out. TypeScript
// rejects the skill project when its include list matches nothing, and a rename case moves a
// module into `docs/`, which Git requires to exist.
const CHECKER_TEMPLATE_STUBS: Record<string, string> = {
	'README.md': 'A static checker fixture.\n',
	'.agents/skills/fixture/scripts/source.ts': 'export const fixture = true;\n',
	'docs/.gitkeep': ''
};
// Bun canonicalizes the checker's module path through the operating-system API, while
// `realpathSync` does not canonicalize the invocation cwd. On Windows GitHub runners,
// os.tmpdir() returns the 8.3 short name (C:\Users\RUNNER~1\...) while REPO_ROOT uses the long
// form, so every relative file argument falls outside the repository. `realpathSync.native`
// resolves through the same operating-system API and returns the same spelling for both sides.
export const TEMP_ROOT = realpathSync.native(tmpdir());

export interface CommandInvocation {
	command: string;
	args: string[];
}

export interface CheckerClone {
	directory: string;
	repository: string;
	env: NodeJS.ProcessEnv;
}

export interface CanaryOutcome {
	status: number | null;
	output: string;
	log: CommandInvocation[];
}

export type SharedKitState = { app: string[] | 'absent'; seeds: string[] };

/**
 * What a SvelteKit seed sync would leave in this checkout's `node_modules`: the generated `$app`
 * entries and `.cache/kit-sync-*` scratch configs. Other `.cache` entries belong to tools that
 * concurrent suites run, so they are not compared.
 */
function sharedKitState(): SharedKitState {
	const modules = path.join(ROOT, 'node_modules');
	const app = path.join(modules, '$app');
	const cache = path.join(modules, '.cache');
	return {
		app: existsSync(app) ? readdirSync(app).sort() : 'absent',
		seeds: existsSync(cache)
			? readdirSync(cache)
					.filter((name) => name.startsWith('kit-sync-'))
					.sort()
			: []
	};
}

export function readCommandLog(logPath: string): CommandInvocation[] {
	if (!existsSync(logPath)) return [];
	return readFileSync(logPath, 'utf8')
		.trim()
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as CommandInvocation);
}

export function runFixtureGit(repository: string, args: string[]): void {
	const result = spawnSync('git', args, {
		cwd: repository,
		env: sanitizedGitEnv(),
		encoding: 'utf8'
	});
	if (result.status !== 0) {
		throw new Error(`Fixture git ${args.join(' ')} failed: ${result.stdout}${result.stderr}`);
	}
}

export function configureFixtureGitIdentity(repository: string): void {
	runFixtureGit(repository, ['config', '--local', 'user.name', 'Static Checks Fixture']);
	runFixtureGit(repository, [
		'config',
		'--local',
		'user.email',
		'static-checks-fixture@example.invalid'
	]);
}

export function shellSingleQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/**
 * Creates the recorders under the names the checker uses to start its child processes.
 *
 * On POSIX these are /bin/sh wrappers. With Bun 1.3.9, the oldest version setup supports, a file built
 * by `bun build --compile` runs as the Bun CLI instead of its own entry point as soon as
 * argv[0] is exactly `bun`, which is precisely how the checker starts its child: recording
 * would fail and the real formatters and linters would run (measured on Linux with 1.3.9;
 * 1.3.14 no longer exhibits the effect). The wrapper instead starts the real Bun by its safely
 * quoted absolute path and passes the recorder source as one argument. Windows does not support
 * this wrapper and therefore keeps the compiled file.
 */
export function createRecorderShims(directory: string, bunPath = BUN): void {
	if (process.platform === 'win32') {
		const compiledBun = path.join(directory, 'bun.exe');
		const compiled = spawnSync(
			bunPath,
			['build', RECORDER_SOURCE, '--compile', '--outfile', compiledBun],
			{
				cwd: directory,
				env: sanitizedGitEnv(),
				encoding: 'utf8'
			}
		);
		if (compiled.status !== 0) {
			throw new Error(`Command recorder compilation failed: ${compiled.stdout}${compiled.stderr}`);
		}
		copyFileSync(compiledBun, path.join(directory, 'misspell.exe'));
		return;
	}
	for (const name of ['bun', 'misspell']) {
		const shim = path.join(directory, name);
		writeFileSync(
			shim,
			`#!/bin/sh\nSTATIC_CHECKS_COMMAND_NAME=${shellSingleQuote(name)} exec ${shellSingleQuote(bunPath)} ${shellSingleQuote(RECORDER_SOURCE)} "$@"\n`
		);
		chmodSync(shim, 0o755);
	}
}

/**
 * Overlays a repository with the worktree copies of Git-tracked sources.
 *
 * Recursively copying ROOT/scripts traversed a directory where static-checks.format.test.ts
 * concurrently created and removed its `.format-*` fixtures. If one disappears between
 * directory enumeration and traversal, the copy aborts; in the measured case, the native
 * directory_iterator exception terminated the entire Vitest worker, silently omitting the
 * final Knip cases. The index instead provides a stable path set that never contains temporary
 * fixtures, and each file is overlaid individually. Deleted index paths are removed explicitly
 * with rename detection disabled, so a staged rename cannot leave the old HEAD path beside the
 * new file. This keeps staged sources under test without traversing or recursively deleting a
 * live directory.
 */
export function overlayIndexedSources(repository: string, sourceRoot = ROOT): void {
	const deleted = spawnSync(
		'git',
		[
			'diff',
			'--cached',
			'--name-only',
			'--diff-filter=D',
			'--no-renames',
			'-z',
			'--',
			...OVERLAY_PATHSPECS
		],
		{
			cwd: sourceRoot,
			env: sanitizedGitEnv(),
			encoding: 'utf8',
			maxBuffer: 16 * 1024 * 1024
		}
	);
	if (deleted.status !== 0) {
		throw new Error(`Failed to list deleted indexed sources: ${deleted.stderr}`);
	}
	for (const file of deleted.stdout.split('\0').filter(Boolean)) {
		rmSync(path.join(repository, file), { force: true });
	}

	const listed = spawnSync('git', ['ls-files', '-z', '--', ...OVERLAY_PATHSPECS], {
		cwd: sourceRoot,
		env: sanitizedGitEnv(),
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024
	});
	if (listed.status !== 0) throw new Error(`Failed to list indexed sources: ${listed.stderr}`);
	const files = listed.stdout.split('\0').filter(Boolean);
	// An empty or incomplete set would let the clone run the committed state and silently skip
	// the change under test.
	if (sourceRoot === ROOT) {
		for (const required of REQUIRED_SOURCES) {
			if (!files.includes(required)) {
				throw new Error(`Git index does not contain ${required}: ${files.length} paths.`);
			}
		}
	}
	for (const file of files) {
		const source = path.join(sourceRoot, file);
		// A source tracked in the index but missing from the worktree must not silently leave the
		// committed version in the clone.
		if (!existsSync(source)) {
			throw new Error(`Indexed source is missing from the worktree: ${file}`);
		}
		mkdirSync(path.dirname(path.join(repository, file)), { recursive: true });
		copyFileSync(source, path.join(repository, file));
	}
}

interface CreatorSeed {
	/** Root scripts added after the state's canonical scripts. */
	scripts?: Record<string, string>;
	/** Child manifest bytes for the present state. */
	childManifest?: string;
}

function seedCreatorState(
	repository: string,
	state: 'present' | 'absent' | 'inconsistent',
	seed: CreatorSeed = {}
): void {
	const manifestPath = path.join(repository, 'package.json');
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
		scripts: Record<string, string>;
	};
	const template = JSON.parse(
		readFileSync(path.join(ROOT, 'scripts/__fixtures__/template-setup/package.json'), 'utf8')
	) as { scripts: Record<string, string> };
	const names = ['install:cli', 'check:cli', 'test:cli', 'build:cli', 'test:cli:packed'];
	const child = path.join(repository, 'packages/create-saas-starter');
	const workflow = path.join(repository, '.github/workflows/create-saas-starter.yml');
	if (state === 'absent') {
		for (const name of names) delete manifest.scripts[name];
		manifest.scripts.postinstall = template.scripts.postinstall.replace(
			'bun run install:cli && ',
			''
		);
		manifest.scripts.test = template.scripts.test.replace(' && bun run test:cli', '');
		rmSync(child, { recursive: true, force: true });
		rmSync(workflow, { force: true });
	} else {
		for (const name of names) manifest.scripts[name] = template.scripts[name]!;
		manifest.scripts.postinstall = template.scripts.postinstall;
		manifest.scripts.test = template.scripts.test;
		mkdirSync(path.join(child, 'src'), { recursive: true });
		writeFileSync(path.join(child, 'src/options.ts'), 'export const option = true;\n');
		writeFileSync(path.join(child, 'tsconfig.json'), '{}\n');
		mkdirSync(path.dirname(workflow), { recursive: true });
		writeFileSync(workflow, 'name: creator\n');
		if (state === 'present')
			writeFileSync(
				path.join(child, 'package.json'),
				seed.childManifest ?? '{"name":"create-saas-starter","scripts":{"knip":"knip"}}\n'
			);
		else rmSync(path.join(child, 'package.json'), { force: true });
	}
	Object.assign(manifest.scripts, seed.scripts);
	writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t') + '\n');
	const observed = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
		scripts: Record<string, string>;
	};
	expect(Object.hasOwn(observed.scripts, 'install:cli')).toBe(state !== 'absent');
	expect(observed.scripts).toMatchObject(seed.scripts ?? {});
	if (seed.childManifest !== undefined)
		expect(readFileSync(path.join(child, 'package.json'), 'utf8')).toBe(seed.childManifest);
	expect(existsSync(child)).toBe(state !== 'absent');
	expect(existsSync(workflow)).toBe(state !== 'absent');
	expect(existsSync(path.join(child, 'package.json'))).toBe(state === 'present');
}

/**
 * Ensures Kit 3's generated base tsconfig exists in `project`, the checker template.
 *
 * Sync writes `node_modules/$app/tsconfig.json`, which is what the root config extends. The
 * template owns a real `node_modules` from `linkDependencies`, and every clone links it, so one
 * sync serves every case and never writes this checkout. A job that installs with
 * `--ignore-scripts` has never synced; the template's `$app` starts absent either way.
 * `.svelte-kit/tsconfig.json` is not a Kit 3 output, and syncing once per case to look for it
 * is not.
 *
 * The sync reads a config with only the stock plugin, not `vite.config.ts`. The application
 * config bootstraps Varlock, and a swallowed failure there ends in `env_invalid`, which would
 * put this tooling suite back on the path `vitest.tooling.config.ts` exists to avoid. The
 * generated base config does not depend on the application's Vite options.
 */
function seedGeneratedKitProject(project: string): void {
	const generated = path.join(project, 'node_modules', '$app', 'tsconfig.json');
	if (existsSync(generated)) return;
	// Inside `node_modules`, so the bare import resolves from the project's packages.
	const cache = path.join(project, 'node_modules', '.cache');
	mkdirSync(cache, { recursive: true });
	const directory = mkdtempSync(path.join(cache, 'kit-sync-'));
	try {
		const config = path.join(directory, 'vite.config.mjs');
		writeFileSync(
			config,
			"import { sveltekit } from '@sveltejs/kit/vite';\nexport default { plugins: [sveltekit()] };\n"
		);
		const sync = withSvelteKitSyncLockSync(project, () =>
			spawnSync(BUN, ['svelte-kit', 'sync', '--config', config], {
				cwd: project,
				env: sanitizedGitEnv(),
				encoding: 'utf8'
			})
		);
		if (sync.status !== 0 || !existsSync(generated)) {
			throw new Error(`SvelteKit sync did not write ${generated}: ${sync.stdout}${sync.stderr}`);
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

/**
 * Builds the private repository every checker clone starts from, once per test file.
 *
 * Each case used to clone the whole repository, copy the checker sources over it, and delete
 * it again, while the full-project runs scanned the entire application corpus. On Windows
 * runners that pushed single cases past their timeout. The template carries the checker as the
 * worktree index has it, through the same validated overlay, and replaces the corpus with the
 * declared files and stand-ins. A declared file that left the index fails the suite here,
 * and a checker import outside the overlay fails the canary, instead of either passing
 * against a repository the cases no longer describe.
 */
function prepareCheckerTemplate(repository: string): void {
	mkdirSync(repository);
	overlayIndexedSources(repository);
	const listed = spawnSync('git', ['ls-files', '-z', '--', ...CHECKER_TEMPLATE_FILES], {
		cwd: ROOT,
		env: sanitizedGitEnv(),
		encoding: 'utf8'
	});
	if (listed.status !== 0) {
		throw new Error(`Failed to list checker template files: ${listed.stderr}`);
	}
	const tracked = listed.stdout.split('\0');
	for (const file of CHECKER_TEMPLATE_FILES) {
		const source = path.join(ROOT, file);
		if (!tracked.includes(file)) throw new Error(`Git index does not contain ${file}.`);
		if (!existsSync(source)) throw new Error(`Checker template file is missing: ${file}`);
		mkdirSync(path.dirname(path.join(repository, file)), { recursive: true });
		copyFileSync(source, path.join(repository, file));
	}
	for (const [file, content] of Object.entries(CHECKER_TEMPLATE_STUBS)) {
		mkdirSync(path.dirname(path.join(repository, file)), { recursive: true });
		writeFileSync(path.join(repository, file), content);
	}
	runFixtureGit(repository, ['init', '--quiet']);
	configureFixtureGitIdentity(repository);
	// Forced, so a global excludes file cannot drop a path the full repository tracks.
	runFixtureGit(repository, ['add', '--all', '--force']);
	runFixtureGit(repository, [
		'commit',
		'--quiet',
		'--no-gpg-sign',
		'--no-verify',
		'-m',
		'Add checker template'
	]);
}

export function runChecker(checkout: CheckerClone, args: string[], input?: string) {
	return spawnSync(BUN, [path.join(checkout.repository, 'scripts', 'static-checks.ts'), ...args], {
		cwd: checkout.repository,
		env: checkout.env,
		encoding: 'utf8',
		input
	});
}

/** Position of an exact recording, making invocation order comparable. */
export function indexOfInvocation(log: CommandInvocation[], invocation: CommandInvocation): number {
	return log.findIndex(
		(entry) =>
			entry.command === invocation.command &&
			entry.args.length === invocation.args.length &&
			entry.args.every((argument, index) => argument === invocation.args[index])
	);
}

/**
 * Counts Knip invocations in both common Bun forms.
 *
 * Measurements show that `bun knip …` and `bun run knip …` start the same package script with
 * the same arguments. Counting only the short form would hide a second invocation in the long
 * form and render the exactly-once contract ineffective. Therefore, `run` is stripped only
 * for comparison; the flags after the script name remain unchanged and are still checked
 * exactly.
 */
export function knipInvocations(checkout: CheckerClone): CommandInvocation[] {
	return readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!)
		.filter((invocation) => invocation.command === 'bun')
		.map((invocation) =>
			invocation.args[0] === 'run' ? { ...invocation, args: invocation.args.slice(1) } : invocation
		)
		.filter((invocation) => invocation.args[0] === 'knip');
}

export function cliKnipInvocations(checkout: CheckerClone): CommandInvocation[] {
	return readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!).filter(
		(invocation) => JSON.stringify(invocation) === JSON.stringify(CLI_KNIP)
	);
}

/** Stages `git rm` of a committed path, or `git mv` to `destination`, in the private clone. */
export function stageRemoval(checkout: CheckerClone, source: string, destination?: string): void {
	runFixtureGit(
		checkout.repository,
		destination ? ['mv', '--', source, destination] : ['rm', '--quiet', '--', source]
	);
	// The creator seed invalidated tracked stat data; refresh it before the checker fingerprints
	// the index, as stageReadme does.
	runFixtureGit(checkout.repository, ['status', '--porcelain=v1', '--untracked-files=all']);
}

/** What `setUp` measured while it built the checker template, for the file's own assertions. */
export interface KnipSuiteState {
	checkerTemplateRepository: string;
	bunVersion: string;
	canary: CanaryOutcome;
	sharedKitStateBefore: SharedKitState;
	sharedKitStateAfter: SharedKitState;
	templateAppBeforeSeed: boolean;
}

/**
 * The command recorder and checker template one test file shares. The file calls `setUp` in
 * its `beforeAll` and `tearDown` in its `afterAll`; `createCheckerClone` and `recorderEnv`
 * work between the two.
 */
export function knipSuite() {
	let recorderDirectory: string;
	let checkerTemplateDirectory: string | undefined;
	let checkerTemplateRepository: string;
	let bunVersion: string;

	function recorderEnv(logPath: string): NodeJS.ProcessEnv {
		const env: NodeJS.ProcessEnv = {
			...sanitizedGitEnv(),
			NO_COLOR: '1',
			PATH: `${recorderDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
			STATIC_CHECKS_COMMAND_LOG: logPath
		};
		delete env.STATIC_CHECKS_COMMAND_NAME;
		return env;
	}

	function createCheckerClone(
		state: 'present' | 'absent' | 'inconsistent' = 'present',
		seed?: CreatorSeed
	): CheckerClone {
		const directory = mkdtempSync(path.join(TEMP_ROOT, 'static-knip-'));
		const repository = path.join(directory, 'repository');
		try {
			// Every case clones its own copy: the cases rewrite manifests, sources, the index,
			// and history.
			const clone = spawnSync(
				'git',
				['clone', '--quiet', '--local', '--no-hardlinks', checkerTemplateRepository, repository],
				{
					env: sanitizedGitEnv(),
					encoding: 'utf8'
				}
			);
			if (clone.status !== 0) throw new Error(`Local checker clone failed: ${clone.stderr}`);
			// The template's own node_modules, which holds the seeded `$app`.
			symlinkSync(
				path.join(checkerTemplateRepository, 'node_modules'),
				path.join(repository, 'node_modules'),
				process.platform === 'win32' ? 'junction' : 'dir'
			);
			seedCreatorState(repository, state, seed);

			return {
				directory,
				repository,
				env: recorderEnv(path.join(directory, 'commands.jsonl'))
			};
		} catch (error) {
			rmSync(directory, { recursive: true, force: true });
			throw error;
		}
	}

	/**
	 * Validates the formatter canary before any matrix case runs.
	 *
	 * If recording does not intercept the call, the checker starts the real formatters, linters,
	 * and type checks: the run is not only invalid but also takes several times longer. The canary
	 * therefore belongs in the suite setup, and its failure aborts the entire file instead of
	 * starting real tools again for every individual case.
	 */
	function runCanary(): CanaryOutcome {
		const checkout = createCheckerClone();
		checkout.env.STATIC_CHECKS_COMMAND_RESPONSE = JSON.stringify({
			...PRETTIER_README,
			status: 23
		});
		try {
			const result = runChecker(checkout, ['--scope', 'format', 'README.md']);
			const outcome: CanaryOutcome = {
				status: result.status,
				output: `${result.stdout}${result.stderr}`,
				log: readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!)
			};
			const recorded = JSON.stringify(outcome.log);
			if (recorded !== JSON.stringify([PRETTIER_README]) || outcome.status !== 23) {
				throw new Error(
					`Recorder did not intercept the command: status ${outcome.status} instead of 23, recorded ${recorded}. ` +
						`Bun used: ${BUN} (${bunVersion}), platform ${process.platform}. ` +
						`The matrix will not run.\n${outcome.output}`
				);
			}
			return outcome;
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}

	/**
	 * Builds the recorder and the checker template, then runs the canary. The calling
	 * `beforeAll` gives it 120 s.
	 */
	function setUp(): KnipSuiteState {
		recorderDirectory = mkdtempSync(path.join(TEMP_ROOT, 'static-command-recorder-'));
		createRecorderShims(recorderDirectory);
		// Record the binary actually used: running Vitest with Bun X does not prove that
		// testExecutable('bun') resolves to the same Bun.
		bunVersion = (spawnSync(BUN, ['--version'], { encoding: 'utf8' }).stdout ?? '').trim();
		checkerTemplateDirectory = mkdtempSync(path.join(TEMP_ROOT, 'static-checker-template-'));
		checkerTemplateRepository = path.join(checkerTemplateDirectory, 'repository');
		prepareCheckerTemplate(checkerTemplateRepository);
		// After the template commit, which force-adds everything present.
		linkDependencies(realpathSync.native(ROOT), checkerTemplateRepository);
		const templateAppBeforeSeed = existsSync(
			path.join(checkerTemplateRepository, 'node_modules', '$app')
		);
		// Holding this checkout's sync lock keeps a concurrent static-check run from syncing it
		// between the two snapshots, so any difference comes from the seed.
		const [sharedKitStateBefore, sharedKitStateAfter] = withSvelteKitSyncLockSync(ROOT, () => {
			const before = sharedKitState();
			seedGeneratedKitProject(checkerTemplateRepository);
			return [before, sharedKitState()] as const;
		});
		return {
			checkerTemplateRepository,
			bunVersion,
			canary: runCanary(),
			sharedKitStateBefore,
			sharedKitStateAfter,
			templateAppBeforeSeed
		};
	}

	function tearDown(): void {
		rmSync(recorderDirectory, { recursive: true, force: true });
		// Unset when setup failed before the template was created.
		if (checkerTemplateDirectory)
			rmSync(checkerTemplateDirectory, { recursive: true, force: true });
	}

	return { setUp, tearDown, createCheckerClone, recorderEnv };
}
