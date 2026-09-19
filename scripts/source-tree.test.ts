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
 * A segment whose text the scan cannot read but which provably names one child: the random
 * suffix `mkdtemp` appends, or a template `namesOneChild` accepts. Such a name can neither be
 * `..` nor contain a separator, so it cannot carry a path out of the directory it was joined
 * onto.
 *
 * The angle brackets keep both sentinels apart from a real segment: no literal the scan
 * splits can spell them, and Windows rejects either character in a path name.
 */
const GENERATED = '<generated>';

/**
 * A segment the scan never read at all: a value computed at run time, a spread of an array
 * it cannot see into. It stands in for one segment so the readable segments in front of it
 * still place the path, but it is traversal-capable, because nothing rules out `..`.
 */
const UNRESOLVED = '<unresolved>';

/**
 * A path a test builds, as segments below the checkout root. `undefined` covers everything
 * the scan cannot anchor: a throwaway checkout under `tmpdir()`, an imported constant, a
 * path that climbs out of the checkout. Those are not reported, because a path the scan
 * cannot anchor is not evidence of a path under `src/`.
 */
type ResolvedPath = string[] | undefined;

/**
 * What a name stands for. A helper takes the directory as one parameter and the name below
 * it as further ones, so a parameter is either an anchored path or the segments a caller
 * passed for it. Keeping the two apart is what lets `createFixture(SOURCE_FIXTURE_ROOT,
 * '..', '.probe')` normalize to the `src/` path it creates instead of reading as parked.
 */
type Binding = { kind: 'path' | 'segments'; segments: string[] } | undefined;

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

/**
 * The interpolations whose value the scan can prove carries no path separator. Two forms,
 * recognized by their shape rather than by their name, because each is provable on its own
 * terms: `randomBytes(n).toString('hex')` is hexadecimal digits, and `process.pid` is a
 * number. Anything else is a value this scan never evaluated, and a fixed prefix in front of
 * it proves nothing about what it contains.
 *
 * Deliberately not a list of approved helper names. A name says nothing about a return
 * value, and a scan that accepted one would be back to trusting text it never read.
 */
function producesNoSeparator(node: ts.Expression): boolean {
	if (ts.isPropertyAccessExpression(node)) return node.getText() === 'process.pid';
	if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
	if (node.expression.name.text !== 'toString') return false;
	const [encoding] = node.arguments;
	if (!encoding || !ts.isStringLiteral(encoding) || encoding.text !== 'hex') return false;
	const source = node.expression.expression;
	return ts.isCallExpression(source) && calleeName(source) === 'randomBytes';
}

/**
 * Whether a template provably names one child. Three conditions, and each removes a way out
 * of the directory the template is joined onto: no separator in its own text, fixed leading
 * text that is not a dot so the name cannot be `..`, and an interpolation whose value is
 * provably separator-free.
 *
 * The third is what a fixed prefix alone does not give. `scan-probe-${suffix}` with a suffix
 * of `/../../.probe` is a traversal wearing a prefix, so the prefix has to be read together
 * with what follows it rather than as a guarantee by itself.
 */
function namesOneChild(template: ts.TemplateExpression): boolean {
	if (/[/\\]/.test(template.getText())) return false;
	if (!/[^.]/.test(template.head.text)) return false;
	return template.templateSpans.every((span) => producesNoSeparator(span.expression));
}

/**
 * Reads one expression as the segments it contributes to a `path.join`. `..` is kept rather
 * than resolved here, because only the whole joined path knows what it climbs out of, and
 * anything the scan cannot read becomes one unresolved segment rather than nothing: a value
 * it never saw is not evidence that the path stays where it was joined.
 */
function argumentSegments(argument: ts.Expression, bindings: Map<string, Binding>): string[] {
	if (ts.isSpreadElement(argument)) {
		// A rest parameter carries the exact segments its call site passed, `..` included.
		return argumentSegments(argument.expression, bindings);
	}
	if (ts.isStringLiteralLike(argument)) {
		// A combined 'src/lib' literal and two separate segments describe the same path, so
		// both are split the same way instead of being recognized by their spelling.
		return argument.text.split(/[/\\]/);
	}
	if (ts.isTemplateExpression(argument)) return [namesOneChild(argument) ? GENERATED : UNRESOLVED];
	if (ts.isIdentifier(argument)) {
		const binding = bindings.get(argument.text);
		if (binding?.kind === 'segments') return binding.segments;
	}
	return [UNRESOLVED];
}

/** Resolves a path expression against the declarations `bindings` already holds. */
function resolvePath(node: ts.Expression, bindings: Map<string, Binding>): ResolvedPath {
	if (ts.isIdentifier(node)) {
		if (node.text === 'SOURCE_FIXTURE_ROOT') return ['src', SOURCE_FIXTURE_DIRECTORY];
		const binding = bindings.get(node.text);
		return binding?.kind === 'path' ? binding.segments : undefined;
	}
	if (isCheckoutRoot(node)) return [];
	if (!ts.isCallExpression(node)) return undefined;

	const callee = calleeName(node);
	const [base, ...rest] = node.arguments;
	if (!base) return undefined;

	// `mkdtempSync(prefix)` creates a sibling of its prefix: same parent, a name the operating
	// system generates and which therefore names one child.
	if (callee === 'mkdtempSync' || callee === 'mkdtemp') {
		const prefix = resolvePath(base, bindings);
		return prefix && prefix.length > 0 ? [...prefix.slice(0, -1), GENERATED] : undefined;
	}
	if (callee !== 'join' && callee !== 'resolve') return undefined;

	const start = resolvePath(base, bindings);
	if (!start) return undefined;
	const segments = [...start];
	for (const argument of rest) segments.push(...argumentSegments(argument, bindings));
	return normalize(segments);
}

/** What one ordinary parameter stands for at a given call site. */
function parameterBinding(
	argument: ts.Expression | undefined,
	bindings: Map<string, Binding>
): Binding {
	if (!argument) return undefined;
	const anchored = resolvePath(argument, bindings);
	if (anchored) return { kind: 'path', segments: anchored };
	return { kind: 'segments', segments: argumentSegments(argument, bindings) };
}

/**
 * What a rest parameter stands for: the segments of every remaining argument in order, `..`
 * included, so a climb spread back into a `path.join` normalizes there.
 */
function restBinding(rest: readonly ts.Expression[], bindings: Map<string, Binding>): Binding {
	const segments: string[] = [];
	for (const argument of rest) segments.push(...argumentSegments(argument, bindings));
	return { kind: 'segments', segments };
}

/**
 * A path a mutating call must not build. Two cases: anywhere under `src/` outside the fixture
 * root, and inside the fixture root but reached through a segment the scan never read.
 *
 * The second is not a guess in the other direction. An unresolved segment is a value decided
 * at run time, `..` among its possible values, so a path built through one is parked only if
 * that value happens not to climb. Reporting it keeps the question in the test that owns the
 * fixture, and it stays bounded to fixture-root mutations: an unresolved segment anywhere
 * else still has to place the path under `src/` on its readable segments alone.
 */
function isReportablePath(resolved: ResolvedPath): boolean {
	if (!resolved || resolved[0] !== 'src') return false;
	if (resolved[1] !== SOURCE_FIXTURE_DIRECTORY) return true;
	return resolved.slice(2).includes(UNRESOLVED);
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

	const analyze = (node: ts.Node, bindings: Map<string, Binding>, stack: Set<string>): void => {
		// A helper body is read once per call site with that site's arguments bound, never with
		// its parameters unbound, so skip it where it is declared.
		if (helperBodies.has(node)) return;

		// Declarations are recorded as they are reached, so a later call resolves the
		// identifier it actually used rather than a same-named one from elsewhere.
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
			const resolved = resolvePath(node.initializer, bindings);
			bindings.set(node.name.text, resolved && { kind: 'path', segments: resolved });
		}

		if (ts.isCallExpression(node)) {
			const callee = calleeName(node);
			const positions = MUTATING_CALLS.get(callee);
			for (const position of positions ?? []) {
				const argument = node.arguments[position];
				if (!argument || !isReportablePath(resolvePath(argument, bindings))) continue;
				lines.add(lineOf(node));
				break;
			}

			const helper = ts.isIdentifier(node.expression)
				? helpers.get(node.expression.text)
				: undefined;
			if (helper && !stack.has(callee)) {
				// Only the arguments this call site passes are bound: an anchored path where the
				// argument names one, the segments it spells otherwise. A rest parameter keeps the
				// whole sequence its call site passed, and one argument the scan cannot read leaves
				// the parameter unresolved rather than guessing what it contributes.
				const scope = new Map(bindings);
				helper.parameters.forEach((parameter, index) => {
					if (!ts.isIdentifier(parameter.name)) return;
					scope.set(
						parameter.name.text,
						parameter.dotDotDotToken
							? restBinding(node.arguments.slice(index), bindings)
							: parameterBinding(node.arguments[index], bindings)
					);
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
	const fileScope = new Map<string, Binding>();
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

/** A helper that takes the parent and the name below it as ordinary parameters. */
const SEGMENT_HELPER = [
	'function createFixture(parent, up, name) {',
	'\tconst directory = path.join(parent, up, name);',
	'\tmkdirSync(directory, { recursive: true });',
	'\trmSync(directory, { recursive: true, force: true });',
	'}'
].join('\n');

/** The same helper taking the name below the parent as a rest parameter. */
const REST_HELPER = [
	'function createFixture(parent, ...segments) {',
	'\tconst directory = path.join(parent, ...segments);',
	'\tmkdirSync(directory, { recursive: true });',
	'\trmSync(directory, { recursive: true, force: true });',
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

	it('follows segments passed as ordinary parameters out of the fixture root', () => {
		const source = `${CHECKOUT_ROOT}
${SEGMENT_HELPER}
createFixture(SOURCE_FIXTURE_ROOT, '..', '.probe');`;
		expect(transientSourceProducers(source)).toEqual([4, 5]);
	});

	it('accepts the same segments parked below the fixture root', () => {
		const source = `${CHECKOUT_ROOT}
${SEGMENT_HELPER}
createFixture(SOURCE_FIXTURE_ROOT, 'nested', '.probe');`;
		expect(transientSourceProducers(source)).toEqual([]);
	});

	it('follows a rest parameter out of the fixture root', () => {
		const source = `${CHECKOUT_ROOT}
${REST_HELPER}
createFixture(SOURCE_FIXTURE_ROOT, '..', '.probe');`;
		expect(transientSourceProducers(source)).toEqual([4, 5]);
	});

	it('accepts a rest parameter that stays below the fixture root', () => {
		const source = `${CHECKOUT_ROOT}
${REST_HELPER}
createFixture(SOURCE_FIXTURE_ROOT);
createFixture(SOURCE_FIXTURE_ROOT, 'nested', '.probe');
createFixture(SOURCE_FIXTURE_ROOT, 'nested/../.probe');`;
		expect(transientSourceProducers(source)).toEqual([]);
	});

	it('reports a rest spread whose segments the scan never read', () => {
		const source = `${CHECKOUT_ROOT}
${REST_HELPER}
const below = JSON.parse(readFileSync(manifest, 'utf8')).segments;
createFixture(SOURCE_FIXTURE_ROOT, ...below);`;
		expect(transientSourceProducers(source)).toEqual([4, 5]);
	});

	it('reports an ordinary parameter whose value the scan never read', () => {
		const source = `${CHECKOUT_ROOT}
${SEGMENT_HELPER}
const up = readFileSync(manifest, 'utf8').trim();
createFixture(SOURCE_FIXTURE_ROOT, up, '.probe');`;
		expect(transientSourceProducers(source)).toEqual([4, 5]);
	});

	it('reports a dynamic name joined straight onto the fixture root', () => {
		const source = `${CHECKOUT_ROOT}
const directory = path.join(SOURCE_FIXTURE_ROOT, suffix);
mkdirSync(directory, { recursive: true });
writeFileSync(path.join(SOURCE_FIXTURE_ROOT, \`\${suffix}\`), 'safe');`;
		expect(transientSourceProducers(source)).toEqual([3, 4]);
	});

	it('reports a fixed prefix in front of an interpolation it never read', () => {
		const source = [
			CHECKOUT_ROOT,
			'mkdirSync(path.join(SOURCE_FIXTURE_ROOT, `scan-probe-${suffix}`), { recursive: true });',
			'rmSync(path.join(SOURCE_FIXTURE_ROOT, `scan-probe-${buildName()}`), { recursive: true });'
		].join('\n');
		expect(transientSourceProducers(source)).toEqual([2, 3]);
	});

	it('reports a traversal spelled in either separator behind a fixed prefix', () => {
		const source = [
			CHECKOUT_ROOT,
			'mkdirSync(path.join(SOURCE_FIXTURE_ROOT, `scan-probe-${hex}/../../.probe`));',
			'mkdirSync(path.join(SOURCE_FIXTURE_ROOT, `scan-probe-${hex}\\\\..\\\\..\\\\.probe`));'
		].join('\n');
		expect(transientSourceProducers(source)).toEqual([2, 3]);
	});

	it('accepts a randomized child that cannot climb out of the fixture root', () => {
		const source = `${CHECKOUT_ROOT}
const probe = path.join(SOURCE_FIXTURE_ROOT, \`scan-probe-\${randomBytes(6).toString('hex')}\`);
mkdirSync(probe, { recursive: true });
const owned = path.join(SOURCE_FIXTURE_ROOT, \`probe-\${process.pid}\`);
mkdirSync(owned, { recursive: true });
const temporary = mkdtempSync(path.join(SOURCE_FIXTURE_ROOT, 'probe-'));
writeFileSync(path.join(temporary, 'probe.svelte'), '<div></div>');
rmSync(probe, { recursive: true, force: true });`;
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
