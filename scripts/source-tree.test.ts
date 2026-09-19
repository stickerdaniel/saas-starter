import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { sanitizedGitEnv } from './git-context';
import { SOURCE_FIXTURE_DIRECTORY } from './source-tree';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The `node:fs` calls that make a path appear or disappear. Reads are deliberately absent:
 * naming an existing source file is what tests are supposed to do, and only a path that
 * comes and goes mid-run can race a walk.
 *
 * Matched by the called property name, so `rmSync`, `fs.rmSync` and `promises.rm` are the
 * same entry.
 */
const MUTATING_CALLS = new Set([
	'appendFile',
	'appendFileSync',
	'copyFile',
	'copyFileSync',
	'cp',
	'cpSync',
	'mkdir',
	'mkdirSync',
	'mkdtemp',
	'mkdtempSync',
	'rename',
	'renameSync',
	'rm',
	'rmSync',
	'rmdir',
	'rmdirSync',
	'symlink',
	'symlinkSync',
	'unlink',
	'unlinkSync',
	'writeFile',
	'writeFileSync'
]);

/**
 * A path a test builds, expressed as segments below one of two known anchors. `unknown`
 * covers everything the scan cannot follow: a throwaway checkout under `tmpdir()`, a
 * function parameter, an interpolated name. Those are not reported, because a path the scan
 * cannot resolve is not evidence of a path under `src/`.
 */
type ResolvedPath = { anchor: 'checkout' | 'fixtures'; segments: string[] } | undefined;

/** `path.resolve(import.meta.dirname, '..')` and the `fileURLToPath` spelling of it. */
function isCheckoutRoot(node: ts.Expression): boolean {
	if (!ts.isCallExpression(node)) return false;
	if (node.expression.getText() !== 'path.resolve') return false;
	const [base, up] = node.arguments;
	if (!base || !up || !ts.isStringLiteral(up) || up.text !== '..') return false;
	const text = base.getText();
	return text === 'import.meta.dirname' || text === 'path.dirname(fileURLToPath(import.meta.url))';
}

function segmentsOf(literal: string): string[] {
	return literal.split(/[/\\]/).filter((segment) => segment !== '' && segment !== '.');
}

/**
 * Resolves a path expression against the declarations `bindings` already holds. Only
 * `path.join`/`path.resolve` chains over string literals are followed; the first argument
 * the scan cannot resolve makes the whole expression unknown.
 */
function resolvePath(node: ts.Expression, bindings: Map<string, ResolvedPath>): ResolvedPath {
	if (ts.isIdentifier(node)) {
		if (node.text === 'SOURCE_FIXTURE_ROOT') return { anchor: 'fixtures', segments: [] };
		return bindings.get(node.text);
	}
	if (isCheckoutRoot(node)) return { anchor: 'checkout', segments: [] };
	if (!ts.isCallExpression(node)) return undefined;

	// `mkdtempSync(path.join(root, 'prefix-'))` returns a sibling of its prefix, so the
	// directory it binds sits wherever the prefix does.
	const callee = ts.isPropertyAccessExpression(node.expression)
		? node.expression.name.text
		: node.expression.getText();
	if (callee === 'mkdtempSync' || callee === 'mkdtemp') {
		const [prefix] = node.arguments;
		return prefix ? resolvePath(prefix, bindings) : undefined;
	}
	if (callee !== 'join' && callee !== 'resolve') return undefined;

	const [base, ...rest] = node.arguments;
	if (!base) return undefined;
	const start = resolvePath(base, bindings);
	if (!start) return undefined;
	const segments = [...start.segments];
	for (const argument of rest) {
		// A combined 'src/lib' literal and two separate segments describe the same path, so
		// both are split the same way instead of being recognized by their spelling.
		if (!ts.isStringLiteral(argument)) return undefined;
		segments.push(...segmentsOf(argument.text));
	}
	return { anchor: start.anchor, segments };
}

/** A checkout path under `src/` that is not parked in the fixture root. */
function isUnparkedSourcePath(resolved: ResolvedPath): boolean {
	if (!resolved || resolved.anchor !== 'checkout') return false;
	if (resolved.segments[0] !== 'src') return false;
	return resolved.segments[1] !== SOURCE_FIXTURE_DIRECTORY;
}

/**
 * Reports every line of `source` that creates, writes or removes a path under `src/` outside
 * the fixture root.
 */
function transientSourceProducers(source: string, fileName = 'probe.test.ts'): number[] {
	const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
	const bindings = new Map<string, ResolvedPath>();
	const lines: number[] = [];

	const visit = (node: ts.Node): void => {
		// Declarations are recorded as they are reached, so a later call resolves the
		// identifier it actually used rather than a same-named one from elsewhere.
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
			bindings.set(node.name.text, resolvePath(node.initializer, bindings));
		}
		if (ts.isCallExpression(node)) {
			const callee = ts.isPropertyAccessExpression(node.expression)
				? node.expression.name.text
				: node.expression.getText();
			if (MUTATING_CALLS.has(callee)) {
				// Every argument is examined rather than the first: `symlinkSync` and `renameSync`
				// carry the path they create in their second one.
				for (const argument of node.arguments) {
					if (!isUnparkedSourcePath(resolvePath(argument, bindings))) continue;
					lines.push(parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1);
					break;
				}
			}
		}
		ts.forEachChild(node, visit);
	};

	visit(parsed);
	return lines;
}

/** Tracked test sources, listed by Git so the scan does not walk `node_modules`. */
function testFiles(): string[] {
	const result = spawnSync('git', ['ls-files', '-z', '--', '*.test.ts'], {
		cwd: ROOT,
		encoding: 'utf8',
		env: sanitizedGitEnv()
	});
	if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr}`);
	return result.stdout.split('\0').filter(Boolean);
}

const CHECKOUT_ROOT = "const repoRoot = path.resolve(import.meta.dirname, '..');";

/**
 * A fixture that appears and vanishes directly under `src/` sits in the path of every suite
 * that walks that tree, and a walk which listed the entry before its owner removed it dies
 * on `ENOENT scandir` while the owning suite stays green. Two suites reintroduced that race
 * after it was first fixed, so the placement rule is checked rather than remembered.
 */
describe('transientSourceProducers', () => {
	it('accepts reading an existing source file', () => {
		const source = `${CHECKOUT_ROOT}
const html = readFileSync(path.join(repoRoot, 'src', 'app.html'), 'utf8');
const shell = readFileSync(path.join(repoRoot, 'src/app.html'), 'utf8');
const entries = readdirSync(path.join(repoRoot, 'src', 'lib'));`;
		expect(transientSourceProducers(source)).toEqual([]);
	});

	it('reports a fixture created, written and removed under src/', () => {
		const source = `${CHECKOUT_ROOT}
const directory = path.join(repoRoot, 'src', '.probe');
mkdirSync(directory, { recursive: true });
writeFileSync(path.join(directory, 'instructions.md'), 'safe');
rmSync(directory, { recursive: true, force: true });`;
		expect(transientSourceProducers(source)).toEqual([3, 4, 5]);
	});

	it('reads a combined literal as the segments it spells', () => {
		const source = `${CHECKOUT_ROOT}
mkdirSync(path.join(repoRoot, 'src/.probe'), { recursive: true });`;
		expect(transientSourceProducers(source)).toEqual([2]);
	});

	it('accepts the same fixture parked in the fixture root', () => {
		const source = `${CHECKOUT_ROOT}
const directory = path.join(SOURCE_FIXTURE_ROOT, '.probe');
const temporary = mkdtempSync(path.join(SOURCE_FIXTURE_ROOT, 'probe-'));
mkdirSync(directory, { recursive: true });
writeFileSync(path.join(temporary, 'instructions.md'), 'safe');
rmSync(directory, { recursive: true, force: true });`;
		expect(transientSourceProducers(source)).toEqual([]);
	});

	it('leaves a throwaway checkout under tmpdir() alone', () => {
		const source = `${CHECKOUT_ROOT}
const checkout = mkdtempSync(path.join(tmpdir(), 'probe-'));
mkdirSync(path.join(checkout, 'src', 'lib'), { recursive: true });
writeFileSync(path.join(checkout, 'src', 'good.ts'), 'source');`;
		expect(transientSourceProducers(source)).toEqual([]);
	});

	it('finds no producer outside the fixture root in the repository', () => {
		const offenders: string[] = [];
		let scanned = 0;

		for (const file of testFiles()) {
			scanned += 1;
			const source = readFileSync(path.join(ROOT, file), 'utf8');
			for (const line of transientSourceProducers(source, file)) offenders.push(`${file}:${line}`);
		}

		// Without this a scan over an empty list reports a clean repository, which is how an
		// exclusion stops protecting anything without failing anything.
		expect(scanned, 'Git listed no test sources; the scan examined nothing.').toBeGreaterThan(0);
		expect(
			offenders,
			`Build these under SOURCE_FIXTURE_ROOT (src/${SOURCE_FIXTURE_DIRECTORY}), the one directory the source-tree walks skip by name.`
		).toEqual([]);
	});
});
