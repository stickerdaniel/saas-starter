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
 * The `node:fs` calls that make a path appear or disappear, mapped to the argument positions
 * that carry the path they act on. Reads are deliberately absent: naming an existing source
 * file is what tests are supposed to do, and only a path that comes and goes mid-run can
 * race a walk.
 *
 * The positions matter as much as the names. A copy and a symlink read their first argument
 * and create their second, so checking both would reject a test that copies real source to a
 * temporary directory, and checking only the first would miss the link it plants. `write`
 * and `append` carry their payload in the second argument, which is data rather than a path
 * and is never inspected.
 *
 * Matched by the called property name, so `rmSync`, `fs.rmSync` and `promises.rm` are the
 * same entry.
 */
const MUTATING_CALLS = new Map<string, readonly number[]>([
	['appendFile', [0]],
	['appendFileSync', [0]],
	['copyFile', [1]],
	['copyFileSync', [1]],
	['cp', [1]],
	['cpSync', [1]],
	['mkdir', [0]],
	['mkdirSync', [0]],
	['mkdtemp', [0]],
	['mkdtempSync', [0]],
	['rename', [0, 1]],
	['renameSync', [0, 1]],
	['rm', [0]],
	['rmSync', [0]],
	['rmdir', [0]],
	['rmdirSync', [0]],
	['symlink', [1]],
	['symlinkSync', [1]],
	['unlink', [0]],
	['unlinkSync', [0]],
	['writeFile', [0]],
	['writeFileSync', [0]]
]);

/**
 * One path segment whose text the scan cannot read: a randomized name, a spread of further
 * segments, the random suffix `mkdtemp` appends. It stands in for exactly one segment rather
 * than making the whole path unknown, because where a fixture is parked is decided by the
 * segments in front of it and those are still readable.
 *
 * The angle brackets keep it apart from a real segment: no literal the scan splits can spell
 * this, and Windows rejects both characters in a path name.
 */
const OPAQUE = '<unreadable>';

/**
 * A path a test builds, as segments below the checkout root. `undefined` covers everything
 * the scan cannot anchor: a throwaway checkout under `tmpdir()`, an imported constant, a
 * path that climbs out of the checkout. Those are not reported, because a path the scan
 * cannot anchor is not evidence of a path under `src/`.
 */
type ResolvedPath = string[] | undefined;

/** `path.resolve(import.meta.dirname, '..')` and the `fileURLToPath` spelling of it. */
function isCheckoutRoot(node: ts.Expression): boolean {
	if (!ts.isCallExpression(node)) return false;
	if (node.expression.getText() !== 'path.resolve') return false;
	const [base, up] = node.arguments;
	if (!base || !up || !ts.isStringLiteral(up) || up.text !== '..') return false;
	const text = base.getText();
	return text === 'import.meta.dirname' || text === 'path.dirname(fileURLToPath(import.meta.url))';
}

function calleeName(node: ts.CallExpression): string {
	return ts.isPropertyAccessExpression(node.expression)
		? node.expression.name.text
		: node.expression.getText();
}

/**
 * Collapses `.` and `..` the way the path libraries do, so a fixture reached by climbing out
 * of the fixture root reads as the `src/` path it really is. A climb past the checkout root
 * leaves the tree the scan reasons about and is therefore unknown.
 */
function normalize(segments: string[]): ResolvedPath {
	const out: string[] = [];
	for (const segment of segments) {
		if (segment === '' || segment === '.') continue;
		if (segment !== '..') {
			out.push(segment);
			continue;
		}
		if (out.length === 0) return undefined;
		out.pop();
	}
	return out;
}

/** Appends one `path.join` argument, or reports that it cannot be read at all. */
function appendArgument(segments: string[], argument: ts.Expression): boolean {
	if (ts.isSpreadElement(argument)) {
		segments.push(OPAQUE);
		return true;
	}
	if (ts.isStringLiteralLike(argument)) {
		// A combined 'src/lib' literal and two separate segments describe the same path, so
		// both are split the same way instead of being recognized by their spelling.
		segments.push(...argument.text.split(/[/\\]/));
		return true;
	}
	// `scan-probe-${hex}` names one directory whatever it interpolates to. A template that
	// spans separators describes an unknown number of them and is not read.
	if (ts.isTemplateExpression(argument) && !/[/\\]/.test(argument.getText())) {
		segments.push(OPAQUE);
		return true;
	}
	return false;
}

/** Resolves a path expression against the declarations `bindings` already holds. */
function resolvePath(node: ts.Expression, bindings: Map<string, ResolvedPath>): ResolvedPath {
	if (ts.isIdentifier(node)) {
		if (node.text === 'SOURCE_FIXTURE_ROOT') return ['src', SOURCE_FIXTURE_DIRECTORY];
		return bindings.get(node.text);
	}
	if (isCheckoutRoot(node)) return [];
	if (!ts.isCallExpression(node)) return undefined;

	const callee = calleeName(node);
	const [base, ...rest] = node.arguments;
	if (!base) return undefined;

	// `mkdtempSync(prefix)` creates a sibling of its prefix: same parent, unreadable name.
	if (callee === 'mkdtempSync' || callee === 'mkdtemp') {
		const prefix = resolvePath(base, bindings);
		return prefix && prefix.length > 0 ? [...prefix.slice(0, -1), OPAQUE] : undefined;
	}
	if (callee !== 'join' && callee !== 'resolve') return undefined;

	const start = resolvePath(base, bindings);
	if (!start) return undefined;
	const segments = [...start];
	for (const argument of rest) if (!appendArgument(segments, argument)) return undefined;
	return normalize(segments);
}

/** A checkout path under `src/` that is not parked in the fixture root. */
function isUnparkedSourcePath(resolved: ResolvedPath): boolean {
	if (!resolved || resolved[0] !== 'src') return false;
	return resolved[1] !== SOURCE_FIXTURE_DIRECTORY;
}

type Helper = { parameters: ts.ParameterDeclaration[]; body: ts.Node };

/**
 * Local helpers, by name. The shape that reintroduced the race twice hides the mutation in a
 * helper and passes the directory in, so a scan that never looks through a call sees a
 * `mkdirSync` on a parameter and reports nothing.
 */
function collectHelpers(parsed: ts.SourceFile): Map<string, Helper> {
	const helpers = new Map<string, Helper>();
	const visit = (node: ts.Node): void => {
		if (ts.isFunctionDeclaration(node) && node.name && node.body) {
			helpers.set(node.name.text, {
				parameters: [...node.parameters],
				body: node.body
			});
		}
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
			const initializer = node.initializer;
			if (
				(ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) &&
				initializer.body
			) {
				helpers.set(node.name.text, {
					parameters: [...initializer.parameters],
					body: initializer.body
				});
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(parsed);
	return helpers;
}

/**
 * Reports every line of `source` that creates, writes or removes a path under `src/` outside
 * the fixture root.
 */
function transientSourceProducers(source: string, fileName = 'probe.test.ts'): number[] {
	const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
	const helpers = collectHelpers(parsed);
	const helperBodies = new Set([...helpers.values()].map((helper) => helper.body));
	const lines = new Set<number>();

	const lineOf = (node: ts.Node): number =>
		parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;

	const analyze = (
		node: ts.Node,
		bindings: Map<string, ResolvedPath>,
		stack: Set<string>
	): void => {
		// A helper body is read once per call site with that site's arguments bound, never with
		// its parameters unbound, so skip it where it is declared.
		if (helperBodies.has(node)) return;

		// Declarations are recorded as they are reached, so a later call resolves the
		// identifier it actually used rather than a same-named one from elsewhere.
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
			bindings.set(node.name.text, resolvePath(node.initializer, bindings));
		}

		if (ts.isCallExpression(node)) {
			const callee = calleeName(node);
			const positions = MUTATING_CALLS.get(callee);
			for (const position of positions ?? []) {
				const argument = node.arguments[position];
				if (!argument || !isUnparkedSourcePath(resolvePath(argument, bindings))) continue;
				lines.add(lineOf(node));
				break;
			}

			const helper = ts.isIdentifier(node.expression)
				? helpers.get(node.expression.text)
				: undefined;
			if (helper && !stack.has(callee)) {
				// Only the arguments this call site passes are bound. A rest parameter takes an
				// unknown number of them, so it stays unresolved rather than guessing a value.
				const scope = new Map(bindings);
				helper.parameters.forEach((parameter, index) => {
					if (!ts.isIdentifier(parameter.name)) return;
					const argument = parameter.dotDotDotToken ? undefined : node.arguments[index];
					scope.set(parameter.name.text, argument ? resolvePath(argument, bindings) : undefined);
				});
				const nested = new Set([...stack, callee]);
				// The body's children, because the body itself is on the skip list.
				ts.forEachChild(helper.body, (child) => analyze(child, scope, nested));
			}
		}

		ts.forEachChild(node, (child) => analyze(child, bindings, stack));
	};

	// The helper bodies are skipped at their declaration, so start from the file itself. Every
	// top-level statement shares one scope, which is what carries a declaration to its use.
	const fileScope = new Map<string, ResolvedPath>();
	ts.forEachChild(parsed, (child) => analyze(child, fileScope, new Set()));
	return [...lines].sort((a, b) => a - b);
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

/** The helper shape a Tailwind suite used while it still parked its probes in `src/lib`. */
const PROBE_HELPER = [
	'function probeFile(parent, ...segments) {',
	'\tconst probeRoot = path.join(parent, `scan-probe-${randomBytes(6).toString("hex")}`);',
	'\tconst dir = path.join(probeRoot, ...segments);',
	'\tfs.mkdirSync(dir, { recursive: true });',
	'\tconst file = path.join(dir, "probe.svelte");',
	'\tfs.writeFileSync(file, "<div></div>");',
	'\treturn file;',
	'}'
].join('\n');

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

	it('follows a climb out of the fixture root back into src/', () => {
		const source = `${CHECKOUT_ROOT}
const directory = path.join(SOURCE_FIXTURE_ROOT, '..', '.probe');
mkdirSync(directory, { recursive: true });
rmSync(path.join(SOURCE_FIXTURE_ROOT, '../.probe'), { recursive: true, force: true });`;
		expect(transientSourceProducers(source)).toEqual([3, 4]);
	});

	it('follows a directory passed into a helper', () => {
		const source = `${CHECKOUT_ROOT}
${PROBE_HELPER}
probeFile(path.join(repoRoot, 'src', 'lib'));`;
		expect(transientSourceProducers(source)).toEqual([5, 7]);
	});

	it('accepts the same helper called with the fixture root', () => {
		const source = `${CHECKOUT_ROOT}
${PROBE_HELPER}
probeFile(SOURCE_FIXTURE_ROOT);
probeFile(SOURCE_FIXTURE_ROOT, 'scratch');
probeFile(path.join(repoRoot, 'scratch'));`;
		expect(transientSourceProducers(source)).toEqual([]);
	});

	it('accepts copying and linking source into a temporary destination', () => {
		const source = `${CHECKOUT_ROOT}
copyFileSync(path.join(repoRoot, 'src', 'app.html'), path.join(tmpdir(), 'copy.html'));
cpSync(path.join(repoRoot, 'src', 'lib'), path.join(tmpdir(), 'lib'), { recursive: true });
symlinkSync(path.join(repoRoot, 'src', 'lib'), path.join(tmpdir(), 'link'));
writeFileSync(path.join(tmpdir(), 'list.txt'), path.join(repoRoot, 'src', 'app.html'));`;
		expect(transientSourceProducers(source)).toEqual([]);
	});

	it('reports a destination and either end of a rename under src/', () => {
		const source = `${CHECKOUT_ROOT}
symlinkSync(path.join(tmpdir(), 'target'), path.join(repoRoot, 'src', '.link'));
copyFileSync(path.join(tmpdir(), 'source.md'), path.join(repoRoot, 'src', '.copy.md'));
renameSync(path.join(repoRoot, 'src', '.probe'), path.join(tmpdir(), 'gone'));
renameSync(path.join(tmpdir(), 'staged'), path.join(repoRoot, 'src', '.probe'));`;
		expect(transientSourceProducers(source)).toEqual([2, 3, 4, 5]);
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
