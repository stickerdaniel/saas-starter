/**
 * Builds the project without the test suite in a temporary copy and checks it like CI does.
 *
 * Usage: bun scripts/check-reduced-export.ts
 *
 * The copy gets the exporter, a non-frozen install that reconciles bun.lock, a frozen install,
 * Confect codegen with its clean-output check, the lint scope (both Knip runs included), the
 * types scope and the build. The check fails when a step fails, or when the copy differs from
 * the full tree outside the export contract: every tracked path of the removed sets is gone, and
 * of the other tracked files only `contractFiles` may change their content, none its mode.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { deletePathSets, reduceManifest, trackedFiles } from './export-profile';
import { FLAT_TREE, inPathSets, type PathSetName } from './path-sets';

const sets: readonly PathSetName[] = ['tests'];
const contractFiles = new Set(['package.json', 'bun.lock']);
const codegenRoots = ['src/lib/convex', 'src/lib/confect/_generated'];
const env = { ...process.env, HUSKY: '0' };

function fail(message: string): never {
	throw new Error(message);
}

function git(cwd: string, ...args: string[]): string {
	const result = spawnSync('git', ['-c', 'core.quotePath=false', ...args], {
		cwd,
		encoding: 'utf8',
		env,
		maxBuffer: 256 * 1024 * 1024
	});
	if (result.status !== 0)
		fail(`git ${args.join(' ')} exited with ${result.status}:\n${result.stderr}`);
	return result.stdout;
}

function step(cwd: string, label: string, ...command: [string, ...string[]]): void {
	console.log(`\n== ${label}: ${command.join(' ')}`);
	const started = performance.now();
	const result = spawnSync(command[0], command.slice(1), { cwd, env, stdio: 'inherit' });
	const seconds = ((performance.now() - started) / 1000).toFixed(0);
	if (result.status !== 0)
		fail(`${label} exited with ${result.status ?? result.signal} after ${seconds} s`);
	console.log(`== ${label} passed in ${seconds} s`);
}

function records(output: string): string[] {
	return output.split('\0').filter(Boolean);
}

function commit(copy: string, message: string): string {
	git(copy, 'add', '--all');
	git(
		copy,
		'-c',
		'user.name=export',
		'-c',
		'user.email=export@localhost',
		'-c',
		'commit.gpgsign=false',
		'commit',
		'--quiet',
		'--no-verify',
		'--allow-empty',
		'--message',
		message
	);
	return git(copy, 'rev-parse', 'HEAD').trim();
}

function copyTree(root: string, copy: string, tracked: readonly string[]): string {
	for (const path of tracked) {
		mkdirSync(dirname(join(copy, path)), { recursive: true });
		cpSync(join(root, path), join(copy, path), { verbatimSymlinks: true });
	}
	git(copy, 'init', '--quiet');
	return commit(copy, 'full');
}

function contractViolations(copy: string, full: string, omitted: readonly string[]): string[] {
	git(copy, 'add', '--all');
	const pending = new Set(omitted);
	const fields = records(git(copy, 'diff', '--cached', '--no-renames', '--raw', '-z', full));
	const violations: string[] = [];
	for (let index = 0; index < fields.length; index += 2) {
		const [fullMode, copyMode, , , status] = fields[index]!.slice(1).split(' ');
		const path = fields[index + 1]!;
		if (status === 'D' && pending.delete(path)) continue;
		if (status === 'M' && contractFiles.has(path) && fullMode === copyMode) continue;
		violations.push(`${status} ${fullMode} ${copyMode}\t${path}`);
	}
	return [...violations, ...[...pending].map((path) => `kept\t${path}`)];
}

const root = git(process.cwd(), 'rev-parse', '--show-toplevel').trim();
const copy = mkdtempSync(join(tmpdir(), 'reduced-export-'));
const started = performance.now();
try {
	const tracked = trackedFiles(root);
	const omitted = tracked.filter((path) => inPathSets(FLAT_TREE, path, sets));
	const full = copyTree(root, copy, tracked);
	const deleted = deletePathSets(copy, tracked, sets, FLAT_TREE);
	const manifest = join(copy, 'package.json');
	writeFileSync(manifest, reduceManifest(readFileSync(manifest, 'utf8'), sets));
	console.log(`Exported ${copy} without ${sets.join(', ')}: ${deleted.length} paths deleted.`);

	step(copy, 'Reconcile bun.lock', 'bun', 'install');
	step(copy, 'Frozen install', 'bun', 'install', '--frozen-lockfile');
	commit(copy, 'export');
	step(copy, 'Confect codegen', 'bun', 'run', 'confect:codegen');
	const codegen = git(
		copy,
		'status',
		'--porcelain=v1',
		'--untracked-files=all',
		'--',
		...codegenRoots
	);
	if (codegen) fail(`Confect codegen changed its committed output:\n${codegen}`);
	step(copy, 'Lint scope', 'bun', 'scripts/static-checks.ts', '--ci', '--scope', 'lint');
	step(copy, 'Types scope', 'bun', 'scripts/static-checks.ts', '--ci', '--scope', 'types');
	step(copy, 'Build', 'bun', 'run', 'build');

	const violations = contractViolations(copy, full, omitted);
	if (violations.length > 0) {
		fail(`The export differs from the full tree outside its contract:\n${violations.join('\n')}`);
	}
	console.log(
		`\nThe export passed. It differs by ${omitted.length} deleted paths and its contract files.`
	);
} catch (error) {
	console.error(`\n${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
} finally {
	console.log(`Duration: ${((performance.now() - started) / 1000).toFixed(0)} s`);
	rmSync(copy, { recursive: true, force: true });
}
