import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { sanitizedGitEnv } from './git-context';

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
 * Matched by the called name, so `rmSync`, `fs.rmSync` and `promises.rm` are the same entry.
 * `open` and `openSync` count only with a flag literal that writes, in `mutatedPositions`.
 */
const MUTATING_CALLS = new Map<string, readonly number[]>([
	['appendFile', [0]],
	['appendFileSync', [0]],
	['copyFile', [1]],
	['copyFileSync', [1]],
	['cp', [1]],
	['cpSync', [1]],
	['createWriteStream', [0]],
	['link', [1]],
	['linkSync', [1]],
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
	['truncate', [0]],
	['truncateSync', [0]],
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
 * The segment a name collapses to past `CANDIDATE_LIMIT`. It reads like `UNRESOLVED`, and in
 * addition never names a snapshot file: the values it replaced could have spelled a traversal
 * the scan had read.
 */
const OVERFLOW = '<overflow>';

/** Whether the scan never read `segment`, so `..` is among its possible values. */
function isUnread(segment: string | undefined): boolean {
	return segment === UNRESOLVED || segment === OVERFLOW;
}

/**
 * A path a test builds, as segments below the checkout root. `undefined` covers everything
 * the scan cannot anchor: a throwaway checkout under `tmpdir()`, an imported constant, a
 * path that climbs out of the checkout. Those are not reported, because a path the scan
 * cannot anchor is not evidence of a path inside the checkout.
 */
type ResolvedPath = string[] | undefined;

/**
 * One value a name can stand for. A helper takes the directory as one parameter and the name
 * below it as further ones, so a value is either an anchored path or the segments a caller
 * passed for it. Keeping the two apart is what lets `createFixture(scratch, '..', '.probe')`
 * normalize to the root path it creates instead of reading as parked under `scratch/`.
 * `undefined` is a value the scan never read.
 */
type Value = { kind: 'path' | 'segments'; segments: string[] } | undefined;

/**
 * Every value a name can hold at one point of the scan, never empty. A branch, a callback or a
 * loop that may not run adds its values to what the name held before instead of replacing it,
 * and a mutating call is reported when any value would be. One value picked by how it reads
 * now cannot stand in for the rest: a later `..` can carry a parked path back into the
 * checkout, and an exempt snapshot path must not hide a source path beside it.
 */
type Binding = readonly Value[];

/**
 * The most candidates a name or a path keeps apart. Past it they collapse to one `OVERFLOW`
 * segment, which every later step reports. Dropping a candidate that reads as parked instead
 * would be unsound, because a later `..` can bring it back.
 */
const CANDIDATE_LIMIT = 16;

/** The value a name collapses to past `CANDIDATE_LIMIT`. */
const TOO_MANY: Value = { kind: 'path', segments: [OVERFLOW] };

/**
 * What every name holds at one point of the scan, in layers. A region writes its own layer and
 * reads through to the layers around it, so entering one copies nothing, and leaving it touches
 * only the names it set.
 */
class Scope {
	private readonly own = new Map<string, Binding>();
	private readonly parent: Scope | undefined;

	constructor(parent?: Scope) {
		this.parent = parent;
	}

	get(name: string): Binding | undefined {
		return this.own.get(name) ?? this.parent?.get(name);
	}

	has(name: string): boolean {
		return this.own.has(name) || (this.parent?.has(name) ?? false);
	}

	set(name: string, binding: Binding): void {
		this.own.set(name, binding);
	}

	/** The names this layer set itself, with what they hold. */
	written(): IterableIterator<[string, Binding]> {
		return this.own.entries();
	}
}

/** The distinct entries of `items`, or only `overflow` once there are too many to keep apart. */
function distinct<T>(items: readonly T[], overflow: T): T[] {
	const unique = [...new Map(items.map((item) => [String(JSON.stringify(item)), item])).values()];
	return unique.length > CANDIDATE_LIMIT ? [overflow] : unique;
}

/**
 * The binding that holds the scanned file's own path. Angle brackets keep it apart from every
 * identifier, and helper scopes read it through the caller's scope like every other name.
 */
const SCANNED_FILE = '<scanned file>';

/**
 * The directory Vitest runs a test file from, which `process.cwd()` names: the checkout root,
 * or the package directory for a test under `packages/<name>/`, which has its own runner.
 */
function runnerRoot(file: readonly string[]): string[] {
	return file[0] === 'packages' && file.length > 2 ? file.slice(0, 2) : [];
}

/**
 * A path anchored to the scanned file's own location, evaluated against where that file sits
 * rather than recognized as one spelling of the checkout root: `import.meta.dirname`,
 * `import.meta.filename`, `__dirname`, `__filename`, `fileURLToPath(import.meta.url)`, and
 * `fileURLToPath(new URL('../..', import.meta.url))`. A nested suite reaches the root by a
 * different number of climbs, and a spelling the scan did not know is how one wrote into the
 * checkout unreported. A local binding shadows the CommonJS globals of the same name.
 * `process.cwd()` is the directory Vitest runs the file from, `runnerRoot`.
 *
 * Every spelling is matched by its exact source text and contains one of `ANCHOR_TEXTS`, which
 * `mayProduce` relies on. A new spelling must keep that true.
 */
function fileAnchoredPath(node: ts.Expression, bindings: Scope): ResolvedPath {
	const file = bindings.get(SCANNED_FILE)?.[0]?.segments;
	if (!file) return undefined;
	const directory = file.slice(0, -1);
	const text = node.getText();
	if (text === 'import.meta.dirname') return directory;
	if (text === 'import.meta.filename') return file;
	if (ts.isIdentifier(node) && !bindings.has(node.text)) {
		if (node.text === '__dirname') return directory;
		if (node.text === '__filename') return file;
	}
	if (!ts.isCallExpression(node)) return undefined;
	if (text === 'process.cwd()') return runnerRoot(file);
	if (calleeName(node) !== 'fileURLToPath') return undefined;

	const [url] = node.arguments;
	if (url?.getText() === 'import.meta.url') return file;
	if (!url || !ts.isNewExpression(url) || url.expression.getText() !== 'URL') return undefined;
	const [relative, base] = url.arguments ?? [];
	if (base?.getText() !== 'import.meta.url' || !relative || !ts.isStringLiteralLike(relative)) {
		return undefined;
	}
	// A URL resolves against the file's directory; a leading slash leaves the checkout.
	if (relative.text.startsWith('/')) return undefined;
	return normalize([...directory, ...relative.text.split('/')]);
}

/** The called name, with Unicode escapes decoded as the runtime decodes them. */
function calleeName(node: ts.CallExpression): string {
	const callee = node.expression;
	if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
	return ts.isIdentifier(callee) ? callee.text : callee.getText();
}

/**
 * Collapses `.` and `..` the way the path libraries do, so a fixture reached by climbing out
 * of `scratch/` reads as the checkout path it really is. A climb past the checkout root
 * leaves the tree the scan reasons about and is therefore unknown. A `..` after a segment the
 * scan never read cannot cancel it, because that segment may itself have climbed: the result
 * is one unresolved segment, which places nothing and is reported. A trailing separator stays
 * as a final empty segment, because text appended to `dir/` names a child of `dir` while text
 * appended to `dir` extends its name.
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
		const popped = out.pop();
		if (popped === UNRESOLVED || popped === OVERFLOW) return [popped];
	}
	if (segments.length > 0 && segments.at(-1) === '') out.push('');
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
 * Reads a template as the segments its literal separators spell, so
 * `src/lib/${name}.md` places a path under `src/lib` instead of reading as one unknown.
 *
 * A segment holding interpolations is `GENERATED` only when it provably names one child: fixed
 * leading text that is not a dot so the name cannot be `..`, and interpolations whose value is
 * provably separator-free. Anything else is `UNRESOLVED`. The second condition is what a fixed
 * prefix alone does not give: `scan-probe-${suffix}` with a suffix of `/../../.probe` is a
 * traversal wearing a prefix, so the prefix has to be read together with what follows it rather
 * than as a guarantee by itself.
 */
function templateSegments(template: ts.TemplateExpression): string[] {
	return stringParts(templatePieces(template));
}

/** A template as its literal texts and interpolations, in source order. */
function templatePieces(template: ts.TemplateExpression): Array<string | ts.Expression> {
	return [
		template.head.text,
		...template.templateSpans.flatMap((span) => [span.expression, span.literal.text])
	];
}

/** `templateSegments` over literal texts and interpolated values in the order they join. */
function stringParts(pieces: ReadonlyArray<string | ts.Expression>): string[] {
	const segments: string[] = [];
	let text = '';
	let leading: string | undefined;
	let expressions: ts.Expression[] = [];
	const close = () => {
		const namesOneChild =
			leading !== undefined && /[^.]/.test(leading) && expressions.every(producesNoSeparator);
		segments.push(expressions.length === 0 ? text : namesOneChild ? GENERATED : UNRESOLVED);
		text = '';
		leading = undefined;
		expressions = [];
	};
	const append = (literal: string) => {
		literal.split(/[/\\]/).forEach((part, index) => {
			if (index > 0) close();
			text += part;
		});
	};

	for (const piece of pieces) {
		if (typeof piece === 'string') {
			append(piece);
			continue;
		}
		leading ??= text;
		expressions.push(piece);
	}
	close();
	return segments;
}

/**
 * Reads one expression as the segments it contributes to a `path.join`, one list per value it
 * can have. `..` is kept rather than resolved here, because only the whole joined path knows
 * what it climbs out of, and anything the scan cannot read becomes one unresolved segment
 * rather than nothing: a value it never saw is not evidence that the path stays where it was
 * joined.
 */
function argumentSegments(argument: ts.Expression, bindings: Scope): string[][] {
	if (ts.isSpreadElement(argument)) {
		// A rest parameter carries the exact segments its call site passed, `..` included.
		return argumentSegments(argument.expression, bindings);
	}
	if (ts.isStringLiteralLike(argument)) {
		// A combined 'src/lib' literal and two separate segments describe the same path, so
		// both are split the same way instead of being recognized by their spelling.
		return [argument.text.split(/[/\\]/)];
	}
	if (ts.isTemplateExpression(argument)) return [templateSegments(argument)];
	const binding = ts.isIdentifier(argument) ? bindings.get(argument.text) : undefined;
	if (!binding) return [[UNRESOLVED]];
	return distinct(
		binding.map((value) =>
			value?.kind === 'segments'
				? value.segments
				: value?.segments.includes(OVERFLOW)
					? [OVERFLOW]
					: [UNRESOLVED]
		),
		[OVERFLOW]
	);
}

/** Every list in `starts` continued by every list in `alternatives`. */
function extend(starts: readonly string[][], alternatives: readonly string[][]): string[][] {
	return distinct(
		starts.flatMap((start) => alternatives.map((more) => [...start, ...more])),
		[OVERFLOW]
	);
}

/**
 * The path a string spells when it starts with an anchored path: `${root}/src/${name}` or
 * `root + '/src/x'`. Text up to the first separator extends the anchor's last segment, so
 * `${scratch}-copy` names a sibling of `scratch/`, not a child. After a trailing separator the
 * anchor's last segment is empty, so the same text names a child. A segment the scan never
 * read in that position leaves the anchor's own name unknown.
 */
function continuePath(anchor: string[], [extension, ...children]: string[]): ResolvedPath {
	if (extension === undefined || extension === '') return normalize([...anchor, ...children]);
	const unknown = extension === UNRESOLVED || extension === GENERATED;
	// Text glued onto the checkout root itself names a directory beside the checkout.
	if (anchor.length === 0) return unknown ? normalize([UNRESOLVED, ...children]) : undefined;
	// Text glued onto a segment the scan never read leaves it unread.
	const last = anchor.at(-1) ?? '';
	const named = isUnread(last) ? last : unknown ? UNRESOLVED : `${last}${extension}`;
	return normalize([...anchor.slice(0, -1), named, ...children]);
}

/** The segments `right` spells when `+` glues it onto a path. */
function appendedParts(right: ts.Expression): string[] {
	return stringParts(
		ts.isStringLiteralLike(right)
			? [right.text]
			: ts.isTemplateExpression(right)
				? templatePieces(right)
				: [right]
	);
}

/** What a name holds once `value` is bound to it: the paths it names, or its segments. */
function valueBinding(value: ts.Expression, bindings: Scope): Binding {
	const candidates = resolvePaths(value, bindings);
	if (candidates.some(Boolean)) {
		return candidates.map((candidate): Value => candidate && { kind: 'path', segments: candidate });
	}
	return argumentSegments(value, bindings).map((segments): Value => ({
		kind: 'segments',
		segments
	}));
}

/**
 * Resolves a path expression against what `bindings` holds, to every path it can name.
 * `undefined` among them is a path the scan cannot anchor.
 */
function resolvePaths(node: ts.Expression, bindings: Scope): ResolvedPath[] {
	if (
		ts.isParenthesizedExpression(node) ||
		ts.isAsExpression(node) ||
		ts.isSatisfiesExpression(node) ||
		ts.isNonNullExpression(node)
	) {
		return resolvePaths(node.expression, bindings);
	}
	// `cond ? path.join(root, 'src/x') : null` and `declared() ?? path.join(root, 'src/x')`
	// produce whichever side runs, so both sides stay candidates.
	const branchNodes = ts.isConditionalExpression(node)
		? [node.whenTrue, node.whenFalse]
		: ts.isBinaryExpression(node) &&
			  (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
					node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
			? [node.left, node.right]
			: undefined;
	if (branchNodes) {
		return distinct(
			branchNodes.flatMap((branch) => resolvePaths(branch, bindings)),
			[OVERFLOW]
		);
	}
	const anchored = fileAnchoredPath(node, bindings);
	if (anchored) return [anchored];
	if (ts.isTemplateExpression(node) && node.head.text === '') {
		const [, first, ...rest] = templatePieces(node);
		if (typeof first === 'string') return [undefined];
		const parts = stringParts(rest);
		return resolvePaths(first, bindings).map((anchor) => anchor && continuePath(anchor, parts));
	}
	if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
		// `a + b + c` parses as `(a + b) + c`, so the left side already carries its separator.
		const parts = appendedParts(node.right);
		return resolvePaths(node.left, bindings).map((anchor) => anchor && continuePath(anchor, parts));
	}
	if (ts.isIdentifier(node)) {
		const binding = bindings.get(node.text) ?? [undefined];
		return binding.map((value) => (value?.kind === 'path' ? value.segments : undefined));
	}
	if (!ts.isCallExpression(node)) return [undefined];

	const callee = calleeName(node);
	const [base, ...rest] = node.arguments;
	if (!base) return [undefined];

	if (callee === 'dirname') {
		return resolvePaths(base, bindings).map((candidate) => {
			const child = candidate?.filter((segment) => segment !== '');
			// The parent of a segment the scan never read is unknown too.
			if (isUnread(child?.at(-1))) return child;
			return child && child.length > 0 ? child.slice(0, -1) : undefined;
		});
	}

	// `mkdtempSync(prefix)` creates a sibling of its prefix: same parent, a name the operating
	// system generates and which therefore names one child.
	if (callee === 'mkdtempSync' || callee === 'mkdtemp') {
		return resolvePaths(base, bindings).map((prefix) =>
			prefix && prefix.length > 0 ? [...prefix.slice(0, -1), GENERATED] : undefined
		);
	}
	if (callee !== 'join' && callee !== 'resolve') return [undefined];

	const starts = resolvePaths(base, bindings);
	let joined = starts.filter((start) => start !== undefined);
	// `join` skips empty arguments, so a trailing `''` leaves no separator behind.
	for (const argument of rest) {
		if (ts.isStringLiteralLike(argument) && argument.text === '') continue;
		joined = extend(joined, argumentSegments(argument, bindings));
	}
	const resolved = joined.map((segments) => {
		const normalized = normalize(segments);
		// `resolve` returns a path without a trailing separator.
		return callee === 'resolve' && normalized?.at(-1) === '' ? normalized.slice(0, -1) : normalized;
	});
	return distinct(starts.includes(undefined) ? [...resolved, undefined] : resolved, [OVERFLOW]);
}

/**
 * Whether the scan reads every value `node` can have: a literal, a bound name, an anchor, the
 * temporary directory, or a path operation on one of those. What a helper returns is not read,
 * and it may be the very path the helper was given.
 */
function isReadable(node: ts.Expression, bindings: Scope): boolean {
	if (
		ts.isParenthesizedExpression(node) ||
		ts.isAsExpression(node) ||
		ts.isSatisfiesExpression(node) ||
		ts.isNonNullExpression(node)
	) {
		return isReadable(node.expression, bindings);
	}
	if (fileAnchoredPath(node, bindings)) return true;
	if (ts.isStringLiteralLike(node)) return true;
	if (ts.isTemplateExpression(node)) {
		const first = node.templateSpans[0]?.expression;
		return node.head.text !== '' || !first || isReadable(first, bindings);
	}
	if (ts.isConditionalExpression(node)) {
		return isReadable(node.whenTrue, bindings) && isReadable(node.whenFalse, bindings);
	}
	if (ts.isBinaryExpression(node)) {
		const kind = node.operatorToken.kind;
		if (kind === ts.SyntaxKind.PlusToken) return isReadable(node.left, bindings);
		const either =
			kind === ts.SyntaxKind.QuestionQuestionToken || kind === ts.SyntaxKind.BarBarToken;
		return either && isReadable(node.left, bindings) && isReadable(node.right, bindings);
	}
	if (ts.isIdentifier(node)) return bindings.has(node.text);
	if (!ts.isCallExpression(node)) return false;
	const callee = calleeName(node);
	if (callee === 'tmpdir') return true;
	const [base] = node.arguments;
	const pathCall = ['join', 'resolve', 'dirname', 'mkdtemp', 'mkdtempSync'].includes(callee);
	return pathCall && base !== undefined && isReadable(base, bindings);
}

/**
 * Whether `argument` passes `undefined`, which runs the parameter's default just as leaving the
 * argument out does: the global `undefined` or any `void` expression.
 */
function passesUndefined(argument: ts.Expression, bindings: Scope): boolean {
	if (ts.isVoidExpression(argument)) return true;
	return ts.isIdentifier(argument) && argument.text === 'undefined' && !bindings.has('undefined');
}

/**
 * What a rest parameter stands for: the segments of every remaining argument in order, `..`
 * included, so a climb spread back into a `path.join` normalizes there.
 */
function restBinding(rest: readonly ts.Expression[], bindings: Scope): Binding {
	let lists: string[][] = [[]];
	for (const argument of rest) lists = extend(lists, argumentSegments(argument, bindings));
	return lists.map((segments): Value => ({ kind: 'segments', segments }));
}

/**
 * Committed snapshots a test rewrites or prunes only when asked to update them, by test file:
 * the one directory whose direct children that file may write or remove. Nothing else in the
 * directory, and nothing from another file, is exempt. This repository has none; a downstream
 * repository lists its snapshot suites here.
 */
const SNAPSHOT_DIRECTORIES: ReadonlyMap<string, string> = new Map();

/**
 * The calls a snapshot update makes: write one snapshot file, or remove a stale one without
 * options, which removes a file and refuses a directory.
 */
const SNAPSHOT_CALLS = new Set([
	'writeFile',
	'writeFileSync',
	'rm',
	'rmSync',
	'unlink',
	'unlinkSync'
]);

/** Whether `call` writes or removes one snapshot file the scanned test owns. */
function isSnapshotUpdate(
	snapshotDirectory: string | undefined,
	call: ts.CallExpression,
	resolved: ResolvedPath
) {
	const callee = calleeName(call);
	if (!SNAPSHOT_CALLS.has(callee)) return false;
	if ((callee === 'rm' || callee === 'rmSync') && call.arguments.length > 1) return false;
	return isSnapshotFile(snapshotDirectory, resolved);
}

/**
 * Whether `resolved` names a direct child of `snapshotDirectory`: a name the
 * scan read, or a `GENERATED` one that provably holds no separator. A name read at run time
 * could be `../src/probe.ts`, and an `OVERFLOW` name stands for several such names, so neither
 * is a snapshot.
 */
function isSnapshotFile(snapshotDirectory: string | undefined, resolved: ResolvedPath): boolean {
	const directory = snapshotDirectory?.split('/');
	if (!directory || !resolved) return false;
	const child = resolved.at(directory.length);
	return (
		resolved.length === directory.length + 1 &&
		directory.every((segment, index) => resolved[index] === segment) &&
		child !== '' &&
		child !== '..' &&
		!isUnread(child)
	);
}

/** The top-level directories of the checkout no whole-tree reader walks. */
const PARKING_DIRECTORIES = new Set(['scratch', 'node_modules']);

/**
 * A path a mutating call must not build. Two cases: anywhere in the checkout outside
 * `scratch/` and `node_modules/`, and inside one of them but reached through a segment the
 * scan never read.
 *
 * The second is not a guess in the other direction. An unresolved segment is a value decided
 * at run time, `..` among its possible values, so a path built through one is parked only if
 * that value happens not to climb. Reporting it keeps the question in the test that owns the
 * fixture.
 */
function isReportablePath(resolved: ResolvedPath): boolean {
	if (!resolved) return false;
	if (!PARKING_DIRECTORIES.has(resolved[0] ?? '')) return true;
	return resolved.slice(1).some(isUnread);
}

/** Whether `flags` is a flag literal that opens for writing, appending or update. */
function opensForWriting(flags: ts.Expression | undefined): boolean {
	return !!flags && ts.isStringLiteralLike(flags) && /[wa+]/.test(flags.text);
}

/** The argument positions of `call` that carry a path it creates, writes or removes. */
function mutatedPositions(call: ts.CallExpression, callee: string): readonly number[] {
	if (callee === 'open' || callee === 'openSync') {
		return opensForWriting(call.arguments[1]) ? [0] : [];
	}
	return MUTATING_CALLS.get(callee) ?? [];
}

/**
 * Whether `node` holds parts that may not run, or may run more than once: the branches of an
 * `if` or a `? :`, the operands of `&&`, `||` and `??`, a function and a loop.
 */
function runsConditionally(node: ts.Node): boolean {
	if (
		ts.isIfStatement(node) ||
		ts.isConditionalExpression(node) ||
		ts.isFunctionLike(node) ||
		ts.isIterationStatement(node, false)
	) {
		return true;
	}
	if (!ts.isBinaryExpression(node)) return false;
	const kind = node.operatorToken.kind;
	return (
		kind === ts.SyntaxKind.AmpersandAmpersandToken ||
		kind === ts.SyntaxKind.BarBarToken ||
		kind === ts.SyntaxKind.QuestionQuestionToken
	);
}

type Helper = { parameters: ts.ParameterDeclaration[]; body: ts.Node };

/** Every identifier a declaration binds, through array and object destructuring. */
function boundNames(name: ts.BindingName): string[] {
	if (ts.isIdentifier(name)) return [name.text];
	return name.elements.flatMap((element) =>
		ts.isOmittedExpression(element) ? [] : boundNames(element.name)
	);
}

/** The names a `let`, `const` or `using` list declares for its own block; none for `var`. */
function blockScopedNames(list: ts.VariableDeclarationList): string[] {
	if ((list.flags & ts.NodeFlags.BlockScoped) === 0) return [];
	return list.declarations.flatMap((declaration) => boundNames(declaration.name));
}

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
 * The helpers whose parameter defaults or body hold a mutating call, directly or through a
 * helper they call. Reading any other helper at a call site cannot report a line, because its
 * bindings stay in its own scope, so those helpers are skipped instead of read once per call.
 */
function mutatingHelpers(helpers: Map<string, Helper>): Set<string> {
	const mutating = new Set<string>();
	const callees = new Map<string, Set<string>>();
	for (const [name, helper] of helpers) {
		const called = new Set<string>();
		const visit = (node: ts.Node): void => {
			if (ts.isCallExpression(node)) {
				if (mutatedPositions(node, calleeName(node)).length > 0) mutating.add(name);
				if (ts.isIdentifier(node.expression) && helpers.has(node.expression.text)) {
					called.add(node.expression.text);
				}
			}
			ts.forEachChild(node, visit);
		};
		for (const part of [...helper.parameters, helper.body]) visit(part);
		callees.set(name, called);
	}
	let grew = true;
	while (grew) {
		grew = false;
		for (const [name, called] of callees) {
			if (mutating.has(name) || ![...called].some((callee) => mutating.has(callee))) continue;
			mutating.add(name);
			grew = true;
		}
	}
	return mutating;
}

/** Text every spelling `fileAnchoredPath` accepts contains; without it no path is anchored. */
const ANCHOR_TEXTS = /import\.meta\.|__dirname|__filename|process\.cwd\(\)/;

/** A callee name `mutatedPositions` can match, as a whole token. */
const MUTATING_NAME = new RegExp(
	`(?<![\\w$])(?:${[...MUTATING_CALLS.keys(), 'open', 'openSync'].join('|')})(?![\\w$])`
);

/**
 * Whether `source` can hold a reportable call, read from its text before any parse. A report
 * needs a mutating call, whose name appears in the text, on a path anchored by a spelling whose
 * text appears too. A `\u` escape can spell either name in a form neither pattern sees, because
 * TypeScript decodes it in an identifier, so a file holding one is always parsed. On
 * 2026-11-13, 136 of 1,102 tracked test sources were parsed, and parsing the others was most
 * of a repository scan.
 */
function mayProduce(source: string): boolean {
	return source.includes('\\u') || (ANCHOR_TEXTS.test(source) && MUTATING_NAME.test(source));
}

/**
 * Reports every line of `source` that creates, writes or removes a statically anchored path
 * inside the checkout outside `scratch/` and `node_modules/`. A path decided only at run time
 * is not seen. `fileName` is the checkout-relative path paths anchored to the file's own
 * location resolve against. `snapshots` maps a test file to the snapshot directory it owns.
 */
function transientSourceProducers(
	source: string,
	fileName = 'scripts/probe.test.ts',
	snapshots = SNAPSHOT_DIRECTORIES
): number[] {
	if (!mayProduce(source)) return [];
	const snapshotDirectory = snapshots.get(fileName);
	// The scan reads no JSDoc, and skipping it saves parse time.
	const parsed = ts.createSourceFile(
		fileName,
		source,
		{ languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone },
		true
	);
	const helpers = collectHelpers(parsed);
	// A helper's body is read once per call site, with that site's arguments bound, never with
	// its parameters unbound, so it is skipped where it is declared. Its defaults are read there
	// too, so a default that runs through an alias or a passed reference is still seen.
	const helperParts = new Set<ts.Node>([...helpers.values()].map((helper) => helper.body));
	const mutating = mutatingHelpers(helpers);
	const lines = new Set<number>();

	const lineOf = (node: ts.Node): number =>
		parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;

	/**
	 * Runs `visit` in a new layer over `bindings`, then adds every value the layer set to the name
	 * it belongs to, except for the names in `local`, which the region declares for itself. What a
	 * name held before stays among its values, because the region may not run.
	 */
	const inScope = (
		bindings: Scope,
		local: readonly string[],
		visit: (scope: Scope) => void
	): void => {
		const scope = new Scope(bindings);
		visit(scope);
		for (const [name, binding] of scope.written()) {
			const before = bindings.get(name);
			if (local.includes(name) || before === binding) continue;
			bindings.set(name, distinct([...(before ?? [undefined]), ...binding], TOO_MANY));
		}
	};

	const analyze = (node: ts.Node, bindings: Scope, stack: Set<string>): void => {
		if (helperParts.has(node)) return;

		// A loop variable names each element in turn, a value the scan never reads, so inside the
		// loop it shadows a same-named path declared earlier instead of inheriting it.
		if (
			(ts.isForOfStatement(node) || ts.isForInStatement(node)) &&
			ts.isVariableDeclarationList(node.initializer)
		) {
			const list = node.initializer;
			analyze(node.expression, bindings, stack);
			inScope(bindings, blockScopedNames(list), (scope) => {
				for (const declaration of list.declarations) {
					for (const name of boundNames(declaration.name)) scope.set(name, [undefined]);
				}
				analyze(node.statement, scope, stack);
			});
			return;
		}

		// A `for` head's `let` and `const` names belong to the loop. The head runs once; the
		// condition, the body and then the update may not run.
		if (ts.isForStatement(node)) {
			const head = node.initializer;
			const local = head && ts.isVariableDeclarationList(head) ? blockScopedNames(head) : [];
			inScope(bindings, local, (scope) => {
				if (head) analyze(head, scope, stack);
				inScope(scope, [], (loop) => {
					for (const part of [node.condition, node.statement, node.incrementor]) {
						if (part) analyze(part, loop, stack);
					}
				});
			});
			return;
		}

		// A block, and a `switch` across all its clauses, keeps the `let` and `const` names it
		// declares to itself, so a same-named path declared inside does not reach past it. A
		// clause may not run, and its statements run in order.
		if (ts.isBlock(node) || ts.isCaseBlock(node)) {
			const statements = ts.isBlock(node)
				? node.statements
				: node.clauses.flatMap((clause) => [...clause.statements]);
			const local = statements.flatMap((statement) =>
				ts.isVariableStatement(statement) ? blockScopedNames(statement.declarationList) : []
			);
			inScope(bindings, local, (scope) =>
				ts.forEachChild(node, (child) =>
					ts.isCaseOrDefaultClause(child)
						? inScope(scope, [], (clause) =>
								ts.forEachChild(child, (part) => analyze(part, clause, stack))
							)
						: analyze(child, scope, stack)
				)
			);
			return;
		}

		// A declaration computes its value first, then binds the name, so a later call resolves
		// the identifier it actually used rather than a same-named one from elsewhere.
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
			analyze(node.initializer, bindings, stack);
			bindings.set(node.name.text, valueBinding(node.initializer, bindings));
			return;
		}

		// An assignment computes its value first, so a write inside the value still sees the old
		// path, then replaces what the name held when the scan reads the value. A value it cannot
		// read, such as what a helper returns, may be the old path, so it adds to the old values,
		// as `??=`, `||=` and `&&=` do. `+=` appends text to each path; any other compound
		// assignment computes a value the scan never reads.
		if (
			ts.isBinaryExpression(node) &&
			ts.isIdentifier(node.left) &&
			node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
			node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
		) {
			const kind = node.operatorToken.kind;
			const keepsOld =
				kind === ts.SyntaxKind.QuestionQuestionEqualsToken ||
				kind === ts.SyntaxKind.BarBarEqualsToken ||
				kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken;
			if (keepsOld) inScope(bindings, [], (scope) => analyze(node.right, scope, stack));
			else analyze(node.right, bindings, stack);

			const name = node.left.text;
			const before = bindings.get(name) ?? [undefined];
			const parts = kind === ts.SyntaxKind.PlusEqualsToken ? appendedParts(node.right) : undefined;
			const appended = parts
				? before.map((value): Value => {
						const extended =
							value?.kind === 'path' ? continuePath(value.segments, parts) : undefined;
						return extended && { kind: 'path', segments: extended };
					})
				: [undefined];
			const replaces = kind === ts.SyntaxKind.EqualsToken && isReadable(node.right, bindings);
			const adds = keepsOld || (kind === ts.SyntaxKind.EqualsToken && !replaces);
			bindings.set(
				name,
				replaces
					? valueBinding(node.right, bindings)
					: distinct(adds ? [...before, ...valueBinding(node.right, bindings)] : appended, TOO_MANY)
			);
			return;
		}

		// A branch, a short-circuit operand, a callback and a loop body may not run, or may run
		// more than once, so what they assign adds to what a name held instead of replacing it.
		if (runsConditionally(node)) {
			ts.forEachChild(node, (child) =>
				inScope(bindings, [], (scope) => analyze(child, scope, stack))
			);
			return;
		}

		if (ts.isCallExpression(node)) {
			const callee = calleeName(node);
			for (const position of mutatedPositions(node, callee)) {
				const argument = node.arguments[position];
				// An exempt snapshot path covers only itself, never a source path beside it.
				const reported =
					argument &&
					resolvePaths(argument, bindings).some(
						(candidate) =>
							isReportablePath(candidate) && !isSnapshotUpdate(snapshotDirectory, node, candidate)
					);
				if (!reported) continue;
				lines.add(lineOf(node));
				break;
			}

			const helper = ts.isIdentifier(node.expression)
				? helpers.get(node.expression.text)
				: undefined;
			if (helper && mutating.has(callee) && !stack.has(callee)) {
				// Only the arguments this call site passes are bound: an anchored path where the
				// argument names one, the segments it spells otherwise. A rest parameter keeps the
				// whole sequence its call site passed, and one argument the scan cannot read leaves
				// the parameter unresolved rather than guessing what it contributes. An argument is
				// read in the caller's scope. A default runs here when the argument is left out or
				// `undefined`, in the helper's scope after the parameters in front of it are bound,
				// so a write the default makes is reported at its own line.
				const scope = new Scope(bindings);
				const nested = new Set([...stack, callee]);
				helper.parameters.forEach((parameter, index) => {
					const argument = node.arguments[index];
					const given = argument && !passesUndefined(argument, bindings) ? argument : undefined;
					if (!parameter.dotDotDotToken && !given && parameter.initializer) {
						analyze(parameter.initializer, scope, nested);
					}
					if (!ts.isIdentifier(parameter.name)) return;
					scope.set(
						parameter.name.text,
						parameter.dotDotDotToken
							? restBinding(node.arguments.slice(index), bindings)
							: given
								? valueBinding(given, bindings)
								: parameter.initializer
									? valueBinding(parameter.initializer, scope)
									: [undefined]
					);
				});
				// The body's children, because the body itself is on the skip list.
				ts.forEachChild(helper.body, (child) => analyze(child, scope, nested));
			}
		}

		ts.forEachChild(node, (child) => analyze(child, bindings, stack));
	};

	// The helper parts are skipped at their declaration, so start from the file itself. Every
	// top-level statement shares one scope, which is what carries a declaration to its use.
	const fileScope = new Scope();
	fileScope.set(SCANNED_FILE, [{ kind: 'path', segments: fileName.split(/[/\\]/) }]);
	ts.forEachChild(parsed, (child) => analyze(child, fileScope, new Set()));
	return [...lines].sort((a, b) => a - b);
}

/**
 * Tracked Vitest and Playwright sources, TypeScript and JavaScript, in every directory, listed
 * by Git so the scan does not walk `node_modules`. A pathspec `*` also matches `/`, so
 * `eslint/rules/` and `e2e/` count.
 */
function testFiles(): string[] {
	const result = spawnSync('git', ['ls-files', '-z', '--', '*.test.[jt]s', '*.spec.[jt]s'], {
		cwd: ROOT,
		encoding: 'utf8',
		env: sanitizedGitEnv()
	});
	if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr}`);
	return result.stdout.split('\0').filter(Boolean);
}

const CHECKOUT_ROOT = "const repoRoot = path.resolve(import.meta.dirname, '..');";

/** A snapshot suite and the directory it owns, for the probes of the snapshot exemption. */
const GOLDEN_SUITE = 'src/lib/convex/customerJourneyGoldens.component.test.ts';
const GOLDENS = new Map([[GOLDEN_SUITE, 'src/lib/convex/admin/customerNotifications/__goldens__']]);

/** Where the probes below park a fixture, and the former source fixture root. */
const PARKED = [
	"const scratch = path.join(repoRoot, 'scratch');",
	"const fixtureRoot = path.join(repoRoot, 'src', '__fixtures__');"
].join('\n');

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
 * A fixture that appears and vanishes in the shared checkout sits in the path of every
 * whole-tree reader a concurrent run starts: a walk that listed the entry before its owner
 * removed it dies on `ENOENT scandir`, and oxlint, knip, ESLint, Prettier, the prose and
 * pattern scans or a type check that reads a malformed or unused fixture fails an unrelated
 * run. The placement rule is checked rather than remembered.
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

	it('reports a fixture at the checkout root or under scripts/', () => {
		const source = `${CHECKOUT_ROOT}
writeFileSync(path.join(repoRoot, \`.format-space-\${process.pid}.ts\`), 'source');
const directory = path.join(repoRoot, 'scripts', \`.format-plus-\${process.pid}\`);
mkdirSync(directory, { recursive: true });
const marker = mkdtempSync(path.join(repoRoot, 'terminal-output-child-'));
symlinkSync(path.join(repoRoot, 'scripts'), path.join(repoRoot, '.format-link'));`;
		expect(transientSourceProducers(source)).toEqual([2, 4, 5, 6]);
	});

	// The shape an ESLint rule suite used to lint a Svelte path it created under src/routes.
	it('anchors a root reached from a nested file through import.meta.url', () => {
		const source = `const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const temporaryRoot = isSvelte ? path.join(repoRoot, 'src/routes/components') : null;
await mkdir(path.dirname(path.join(repoRoot, 'src', 'routes', 'probe', 'page.svelte')));
await rm(temporaryRoot, { recursive: true, force: true });`;
		expect(transientSourceProducers(source, 'eslint/rules/probe.test.ts')).toEqual([3, 4]);
	});

	it('places a fixture directory next to the test module', () => {
		const source =
			"fixtures = fs.mkdtempSync(path.join(import.meta.dirname, 'tmp-svelte-module-extension-'));";
		expect(transientSourceProducers(source, 'eslint/rules/probe.test.ts')).toEqual([1]);
	});

	it('places a file under the checkout root that process.cwd() names', () => {
		const source = [
			"const fixture = join(process.cwd(), 'e2e', 'public-lifecycle-probe.spec.ts');",
			"writeFileSync(fixture, 'source');",
			'rmSync(fixture, { force: true });'
		].join('\n');
		expect(transientSourceProducers(source)).toEqual([2, 3]);
	});

	it('places process.cwd() in the package directory for a package test', () => {
		const source = "writeFileSync(path.join(process.cwd(), 'scratch', 'probe.ts'), 'x');";
		expect(transientSourceProducers(source)).toEqual([]);
		const packageTest = 'packages/create-saas-starter/test/probe.test.ts';
		expect(transientSourceProducers(source, packageTest)).toEqual([1]);
	});

	it('places the dirname spelling of the module root', () => {
		const source = [
			"const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');",
			"writeFileSync(path.join(ROOT, '.probe.ts'), 'source');"
		].join('\n');
		expect(transientSourceProducers(source)).toEqual([2]);
	});

	it('places the module anchors unless a local binding shadows them', () => {
		const source = [
			"writeFileSync(path.join(__dirname, 'probe.ts'), 'x');",
			"writeFileSync(__filename, 'x');",
			"writeFileSync(import.meta.filename, 'x');",
			'function park(__dirname: string) {',
			"	writeFileSync(path.join(__dirname, 'probe.ts'), 'x');",
			'}',
			"park(path.join(tmpdir(), 'probe'));"
		].join('\n');
		expect(transientSourceProducers(source)).toEqual([1, 2, 3]);
	});

	it('reads the segments after an inline module root', () => {
		const source = [
			"const inline = mkdtempSync(path.resolve(import.meta.dirname, '..', 'scratch', 'probe-'));",
			"const root = path.resolve(import.meta.dirname, '..');",
			"const separate = mkdtempSync(path.join(root, 'scratch', 'probe-'));",
			"const source = mkdtempSync(path.resolve(import.meta.dirname, '..', 'src', 'probe-'));"
		].join('\n');
		expect(transientSourceProducers(source)).toEqual([4]);
	});

	it('reads a path named by a string constant', () => {
		const source = `${CHECKOUT_ROOT}
const relative = \`src/lib/content/.untracked-\${process.pid}.md\`;
writeFileSync(path.join(repoRoot, relative), 'safe');
const parked = \`scratch/.untracked-\${process.pid}.md\`;
writeFileSync(path.join(repoRoot, parked), 'safe');`;
		expect(transientSourceProducers(source)).toEqual([3]);
	});

	it('places a path spelled as an anchored template or concatenation', () => {
		const source = `${CHECKOUT_ROOT}
${PARKED}
writeFileSync(\`\${repoRoot}/src/probe.ts\`, 'x');
writeFileSync(repoRoot + '/src/probe.ts', 'x');
writeFileSync(\`\${scratch}/probe.ts\`, 'x');
mkdirSync(\`\${scratch}-copy\`);
writeFileSync(\`\${scratch}\${name}\`, 'x');
mkdirSync(\`\${repoRoot}-copy\`);`;
		expect(transientSourceProducers(source)).toEqual([4, 5, 7, 8]);
	});

	it('keeps a trailing separator when the next operand names a child', () => {
		const source = `${CHECKOUT_ROOT}
${PARKED}
writeFileSync(repoRoot + '/' + 'src/probe.ts', 'x');
writeFileSync(scratch + '/' + 'probe.ts', 'x');
const rootPrefix = repoRoot + '/';
writeFileSync(rootPrefix + 'src/probe.ts', 'x');
writeFileSync(\`\${fileURLToPath(new URL('./', import.meta.url))}\${name}\`, 'x');
writeFileSync(path.resolve(repoRoot, 'scratch/') + 'probe.ts', 'x');
writeFileSync(path.join(repoRoot, 'scratch', '') + 'probe.ts', 'x');
mkdtempSync(path.join(repoRoot, 'scratch', ''));
writeFileSync(path.join(repoRoot, 'scratch/') + 'probe.ts', 'x');`;
		expect(transientSourceProducers(source)).toEqual([4, 7, 8, 9, 10]);
	});

	it('accepts the golden suite updating its own snapshots and nothing else', () => {
		const source = [
			"const goldens = fileURLToPath(new URL('./admin/customerNotifications/__goldens__/', import.meta.url));",
			"writeFileSync(path.join(goldens, name), 'x');",
			'rmSync(`${goldens}${stale}`);',
			"mkdirSync(path.join(goldens, 'probe'));",
			"writeFileSync(path.join(goldens, 'probe', 'broken.ts'), 'x');",
			"writeFileSync(path.join(goldens, '..', 'probe.ts'), 'x');",
			"renameSync(staging, path.join(goldens, 'probe'));",
			"rmSync(path.join(goldens, 'probe'), { recursive: true });",
			"writeFileSync(update ? path.join(goldens, 'a.txt') : path.join(process.cwd(), 'src/x.ts'), 'x');",
			"const target = update ? path.join(goldens, 'a.txt') : path.join(process.cwd(), 'src/x.ts');",
			"writeFileSync(target, 'x');",
			"writeFileSync(path.join(goldens, 'welcome.snapshot.html'), 'x');",
			'rmSync(path.join(goldens, `stale-${process.pid}.html`));',
			// A name read at run time, such as `../src/probe.ts`, can leave the directory.
			"const read = readFileSync(manifest, 'utf8').trim();",
			"writeFileSync(path.join(goldens, read), 'x');"
		].join('\n');
		expect(transientSourceProducers(source, GOLDEN_SUITE, GOLDENS)).toEqual([
			2, 3, 4, 5, 6, 7, 8, 9, 11, 15
		]);
		expect(
			transientSourceProducers(source, 'src/lib/convex/other.component.test.ts', GOLDENS)
		).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 15]);
	});

	// One mutating call and one anchor per source, so the text check before the parse has to
	// recognize exactly that name and that spelling for the write to be reported. Written out
	// rather than read from MUTATING_CALLS, so a call dropped from the map fails here.
	it.each([
		['appendFile', 0],
		['appendFileSync', 0],
		['copyFile', 1],
		['copyFileSync', 1],
		['cp', 1],
		['cpSync', 1],
		['createWriteStream', 0],
		['link', 1],
		['linkSync', 1],
		['mkdir', 0],
		['mkdirSync', 0],
		['mkdtemp', 0],
		['mkdtempSync', 0],
		['open', 0],
		['openSync', 0],
		['rename', 0],
		['rename', 1],
		['renameSync', 0],
		['renameSync', 1],
		['rm', 0],
		['rmSync', 0],
		['rmdir', 0],
		['rmdirSync', 0],
		['symlink', 1],
		['symlinkSync', 1],
		['truncate', 0],
		['truncateSync', 0],
		['unlink', 0],
		['unlinkSync', 0],
		['writeFile', 0],
		['writeFileSync', 0]
	] as const)('reports %s on its path argument %i', (name, position) => {
		const args = Array.from({ length: position + 1 }, (_, index) =>
			index === position ? "path.join(process.cwd(), 'src', 'probe.ts')" : 'other'
		);
		if (name === 'open' || name === 'openSync') args.push("'w'");
		expect(transientSourceProducers(`fs.${name}(${args.join(', ')});`)).toEqual([1]);
	});

	it.each([
		"fs.\\u0072mSync(path.join(process.cwd(), 'src', 'probe.ts'));",
		"\\u0072mSync(path.join(process.cwd(), 'src', 'probe.ts'));",
		"writeFileSync(path.join(\\u005f_dirname, 'probe.ts'), 'x');"
	])('reads a name spelled with a Unicode escape in %s', (source) => {
		expect(transientSourceProducers(source)).toEqual([1]);
	});

	it.each([
		'import.meta.dirname',
		'__dirname',
		"fileURLToPath(new URL('.', import.meta.url))",
		'process.cwd()'
	])('reports a write anchored only by the directory %s', (anchor) => {
		const source = `writeFileSync(path.join(${anchor}, 'probe.ts'), 'x');`;
		expect(transientSourceProducers(source)).toEqual([1]);
	});

	it.each(['import.meta.filename', '__filename', 'fileURLToPath(import.meta.url)'])(
		'reports a write anchored only by the file %s',
		(anchor) => {
			expect(transientSourceProducers(`writeFileSync(${anchor}, 'x');`)).toEqual([1]);
		}
	);

	it('checks both sides of a fallback', () => {
		const source = [
			"const tape = declared() ?? path.join(process.cwd(), 'src/tape.jsonl');",
			'rmSync(tape, { force: true });',
			"const parked = declared() || path.join(process.cwd(), 'scratch/tape.jsonl');",
			'rmSync(parked, { force: true });'
		].join('\n');
		expect(transientSourceProducers(source)).toEqual([2]);
	});

	it('reports a climb back out of a segment the scan never read', () => {
		const source = `${CHECKOUT_ROOT}
${PARKED}
const part = readFileSync(manifest, 'utf8').trim();
writeFileSync(path.join(scratch, part, '..', 'src/probe.ts'), 'x');
writeFileSync(path.join(scratch, 'fixed', '..', 'probe.ts'), 'x');
writeFileSync(path.join(scratch, \`probe-\${process.pid}\`, '..', 'probe.ts'), 'x');`;
		expect(transientSourceProducers(source)).toEqual([5]);
	});

	it('follows an assignment to a bound name', () => {
		const source = `${CHECKOUT_ROOT}
let destination = path.join(repoRoot, 'scratch/probe.ts');
writeFileSync(destination, 'x');
destination = path.join(repoRoot, 'src/probe.ts');
writeFileSync(destination, 'x');
let parked = path.join(repoRoot, 'scratch');
parked += '/../src/probe.ts';
writeFileSync(parked, 'x');
let moved = path.join(repoRoot, 'src/probe.ts');
moved = path.join(tmpdir(), 'probe.ts');
writeFileSync(moved, 'x');`;
		expect(transientSourceProducers(source)).toEqual([5, 8]);
	});

	it('keeps the old path when a helper may return it', () => {
		const source = `function prepareFixture(dir) {
	return dir;
}
let destination = path.join(process.cwd(), 'src/.fixture');
destination = prepareFixture(destination);
writeFileSync(destination, 'x');`;
		expect(transientSourceProducers(source)).toEqual([6]);
	});

	it('reports a reassigned parked path that climbs back into the checkout', () => {
		const source = `let directory = path.join(process.cwd(), 'src');
directory = path.join(process.cwd(), 'scratch/nested');
rmSync(path.join(directory, '..', '..', 'src/probe.ts'));`;
		expect(transientSourceProducers(source)).toEqual([3]);
	});

	it('reports a fallback branch that climbs back into the checkout', () => {
		const source = `const nested = flag ? path.join(process.cwd(), 'scratch/nested') : undefined;
rmSync(path.join(nested ?? path.join(process.cwd(), 'scratch'), '..', 'probe.ts'));`;
		expect(transientSourceProducers(source)).toEqual([2]);
	});

	it('keeps a source path an exempt snapshot path may not replace', () => {
		const source = `const goldens = fileURLToPath(new URL('./admin/customerNotifications/__goldens__/', import.meta.url));
let target = path.join(process.cwd(), 'src/probe.ts');
if (updateGoldens) {
	target = path.join(goldens, 'case.json');
}
writeFileSync(target, 'x');
writeFileSync(path.join(goldens, 'case.json'), 'x');`;
		expect(transientSourceProducers(source, GOLDEN_SUITE, GOLDENS)).toEqual([6]);
	});

	it('reports a name with more possible paths than the scan keeps apart', () => {
		const source = [
			"let target = path.join(process.cwd(), 'scratch/0.ts');",
			...Array.from(
				{ length: 16 },
				(_, index) =>
					`if (flag${index}) target = path.join(process.cwd(), 'scratch/${index + 1}.ts');`
			),
			"if (last) target = path.join(process.cwd(), 'src/probe.ts');",
			'rmSync(target);'
		].join('\n');
		expect(transientSourceProducers(source)).toEqual([19]);
	});

	it('keeps a name a for head declares inside the loop', () => {
		const source = `const target = path.join(process.cwd(), 'src/probe.ts');
const parked = path.join(process.cwd(), 'scratch/probe.ts');
for (let target = path.join(process.cwd(), 'scratch/a.ts'), parked = path.join(process.cwd(), 'src/a.ts'); !done; ) rmSync(target);
rmSync(target);
rmSync(parked);`;
		expect(transientSourceProducers(source)).toEqual([4]);
	});

	it('reads a for body before its update', () => {
		const source = `for (let destination = path.join(process.cwd(), 'src/.probe'); destination; destination = '') {
	mkdirSync(destination, { recursive: true });
}`;
		expect(transientSourceProducers(source)).toEqual([2]);
	});

	it('keeps a name a switch declares inside the switch', () => {
		const source = `const target = path.join(process.cwd(), 'src/probe.ts');
const parked = path.join(process.cwd(), 'scratch/probe.ts');
switch (kind) {
	case 'a':
		const target = path.join(process.cwd(), 'scratch/a.ts');
		const parked = path.join(process.cwd(), 'src/a.ts');
		rmSync(target);
}
rmSync(target);
rmSync(parked);`;
		expect(transientSourceProducers(source)).toEqual([9]);
	});

	it('keeps a reportable path a conditional assignment may not replace', () => {
		const source = `let destination = path.join(process.cwd(), 'src/probe.ts');
if (flag) {
	destination = path.join(process.cwd(), 'scratch/probe.ts');
}
rmSync(destination);`;
		expect(transientSourceProducers(source)).toEqual([5]);
	});

	it('reports a write through the old path inside the assigned value', () => {
		const source = `let destination = path.join(process.cwd(), 'src/probe.ts');
destination = (writeFileSync(destination, 'x'), path.join(process.cwd(), 'scratch/probe.ts'));`;
		expect(transientSourceProducers(source)).toEqual([2]);
	});

	it('reports a name with more possible parked paths than the scan keeps apart', () => {
		const source = [
			"let target = path.join(process.cwd(), 'scratch/0.ts');",
			...Array.from(
				{ length: 16 },
				(_, index) =>
					`if (flag${index}) target = path.join(process.cwd(), 'scratch/${index + 1}.ts');`
			),
			'rmSync(target);'
		].join('\n');
		expect(transientSourceProducers(source)).toEqual([18]);
	});

	it('reports a snapshot name with more possible values than the scan keeps apart', () => {
		const source = [
			"const goldens = fileURLToPath(new URL('./admin/customerNotifications/__goldens__/', import.meta.url));",
			"let name = 'case0.json';",
			...Array.from({ length: 15 }, (_, index) => `if (f${index}) name = 'case${index + 1}.json';`),
			"if (escape) name = '../../../../../../src/probe.ts';",
			"writeFileSync(path.join(goldens, name), 'x');"
		].join('\n');
		expect(transientSourceProducers(source, GOLDEN_SUITE, GOLDENS)).toEqual([19]);
	});

	it('keeps a segment the scan never read unread under glued text and dirname', () => {
		const source = `${CHECKOUT_ROOT}
${PARKED}
const name = readFileSync(manifest, 'utf8').trim();
writeFileSync(path.join(scratch, name) + '-copy', 'x');
rmSync(path.dirname(path.join(scratch, name)), { recursive: true });`;
		expect(transientSourceProducers(source)).toEqual([5, 6]);
	});

	it('keeps a reportable var path through a loop that may not run', () => {
		const source = `var destination = path.join(process.cwd(), 'src/probe.ts');
for (var destination of []) {
	void destination;
}
rmSync(destination);`;
		expect(transientSourceProducers(source)).toEqual([5]);
	});

	it('keeps a name a block declares inside that block', () => {
		const source = `${CHECKOUT_ROOT}
let target = path.join(repoRoot, 'scratch/probe.ts');
const directory = path.join(repoRoot, 'src');
{
	const directory = path.join(repoRoot, 'scratch');
	writeFileSync(path.join(directory, 'probe.ts'), 'x');
}
if (update) {
	target = path.join(repoRoot, 'src/probe.ts');
}
rmSync(directory, { recursive: true });
writeFileSync(target, 'x');`;
		expect(transientSourceProducers(source)).toEqual([11, 12]);
	});

	it('reports the write forms beside writeFile into the checkout and nowhere else', () => {
		const source = `${CHECKOUT_ROOT}
${PARKED}
linkSync(existing, path.join(repoRoot, 'src/probe.ts'));
link(existing, path.join(repoRoot, 'src/probe.ts'), done);
createWriteStream(path.join(repoRoot, 'src/probe.ts'));
truncateSync(path.join(repoRoot, 'src/probe.ts'));
await truncate(path.join(repoRoot, 'src/probe.ts'));
openSync(path.join(repoRoot, 'src/probe.ts'), 'w');
await open(path.join(repoRoot, 'src/probe.ts'), 'a+');
openSync(path.join(repoRoot, 'src/app.html'), 'r');
openSync(path.join(repoRoot, 'src/app.html'));
linkSync(path.join(repoRoot, 'src/app.html'), path.join(tmpdir(), 'link'));
linkSync(existing, path.join(scratch, 'link'));
createWriteStream(path.join(scratch, 'log.txt'));
truncateSync(path.join(tmpdir(), 'probe.ts'));
openSync(path.join(scratch, 'probe.ts'), 'w');
writer.write(path.join(repoRoot, 'src/probe.ts'));`;
		expect(transientSourceProducers(source)).toEqual([4, 5, 6, 7, 8, 9, 10]);
	});

	it.each(['undefined', 'void 0'])('binds the default when the call passes %s', (value) => {
		const source = `${CHECKOUT_ROOT}
function fixture(relative, root = repoRoot) {
	writeFileSync(path.join(root, relative), 'x');
}
fixture('src/probe.ts', ${value});`;
		expect(transientSourceProducers(source)).toEqual([3]);
	});

	it('runs a default in the scope of the parameters before it', () => {
		const source = `function create(root, name = path.join(root, 'src/probe.ts')) {
	writeFileSync(name, 'x');
}
create(process.cwd());
create(process.cwd(), path.join(tmpdir(), 'probe.ts'));`;
		expect(transientSourceProducers(source)).toEqual([2]);
	});

	it('reports a write a default makes when the call runs it', () => {
		const source = `function seed(root, ignored = writeFileSync(path.join(root, 'src/probe.ts'), 'x')) {
	void ignored;
}
function keep(root, ignored = writeFileSync(path.join(root, 'src/kept.ts'), 'x')) {
	void ignored;
}
seed(process.cwd());
keep(process.cwd(), 'given');`;
		expect(transientSourceProducers(source)).toEqual([1]);
	});

	it('reports a write in a default of a helper called through an alias', () => {
		const source = `function seed(ignored = writeFileSync(path.join(process.cwd(), 'src/.probe'), 'x')) {
	void ignored;
}
const invokeSeed = seed;
invokeSeed();`;
		expect(transientSourceProducers(source)).toEqual([1]);
	});

	it('binds the default of a parameter the call site leaves out', () => {
		const source = `${CHECKOUT_ROOT}
function fixture(relative, root = repoRoot) {
	writeFileSync(path.join(root, relative), 'x');
}
fixture('src/probe.ts');
fixture('src/probe.ts', mkdtempSync(path.join(tmpdir(), 'probe-')));`;
		expect(transientSourceProducers(source)).toEqual([3]);
	});

	it('reads a loop variable as the element it names, not an earlier path', () => {
		const source = `${CHECKOUT_ROOT}
const dir = path.join(repoRoot, 'src');
for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true });
for (const [dir, body] of Object.entries(files)) writeFileSync(dir, body);
rmSync(dir, { recursive: true });`;
		expect(transientSourceProducers(source)).toEqual([5]);
	});

	it('reads a combined literal as the segments it spells', () => {
		const source = `${CHECKOUT_ROOT}
mkdirSync(path.join(repoRoot, 'src/.probe'), { recursive: true });`;
		expect(transientSourceProducers(source)).toEqual([2]);
	});

	it('follows a climb out of scratch back into the checkout', () => {
		const source = `${CHECKOUT_ROOT}
${PARKED}
const directory = path.join(scratch, '..', '.probe');
mkdirSync(directory, { recursive: true });
rmSync(path.join(scratch, '../.probe'), { recursive: true, force: true });`;
		expect(transientSourceProducers(source)).toEqual([5, 6]);
	});

	it('follows a directory through a helper that mutates in another helper', () => {
		const source = `${CHECKOUT_ROOT}
function place(directory, name) {
	writeFileSync(path.join(directory, name), 'x');
}
function parkUnder(directory) {
	const name = 'probe.ts';
	place(directory, name);
}
function readOnly(directory) {
	return readFileSync(path.join(directory, 'app.html'), 'utf8');
}
readOnly(path.join(repoRoot, 'src'));
parkUnder(path.join(repoRoot, 'src'));`;
		expect(transientSourceProducers(source)).toEqual([3]);
	});

	it('follows a directory passed into a helper', () => {
		const source = `${CHECKOUT_ROOT}
${PROBE_HELPER}
probeFile(path.join(repoRoot, 'src', 'lib'));`;
		expect(transientSourceProducers(source)).toEqual([5, 7]);
	});

	it('reports the same helper called with the former fixture root', () => {
		const source = `${CHECKOUT_ROOT}
${PARKED}
${PROBE_HELPER}
probeFile(fixtureRoot);`;
		expect(transientSourceProducers(source)).toEqual([7, 9]);
	});

	it('accepts the same helper called with scratch or node_modules', () => {
		const source = `${CHECKOUT_ROOT}
${PARKED}
${PROBE_HELPER}
probeFile(scratch);
probeFile(scratch, 'nested');
probeFile(path.join(repoRoot, 'node_modules', '.cache'));`;
		expect(transientSourceProducers(source)).toEqual([]);
	});

	it('follows segments passed as ordinary parameters out of scratch', () => {
		const source = `${CHECKOUT_ROOT}
${PARKED}
${SEGMENT_HELPER}
createFixture(scratch, '..', '.probe');`;
		expect(transientSourceProducers(source)).toEqual([6, 7]);
	});

	it('accepts the same segments parked below scratch', () => {
		const source = `${CHECKOUT_ROOT}
${PARKED}
${SEGMENT_HELPER}
createFixture(scratch, 'nested', '.probe');`;
		expect(transientSourceProducers(source)).toEqual([]);
	});

	it('reports the same segments below the former fixture root', () => {
		const source = `${CHECKOUT_ROOT}
${PARKED}
${SEGMENT_HELPER}
createFixture(fixtureRoot, 'nested', '.probe');`;
		expect(transientSourceProducers(source)).toEqual([6, 7]);
	});

	it('follows a rest parameter out of scratch', () => {
		const source = `${CHECKOUT_ROOT}
${PARKED}
${REST_HELPER}
createFixture(scratch, '..', '.probe');`;
		expect(transientSourceProducers(source)).toEqual([6, 7]);
	});

	it('accepts a rest parameter that stays below scratch', () => {
		const source = `${CHECKOUT_ROOT}
${PARKED}
${REST_HELPER}
createFixture(scratch);
createFixture(scratch, 'nested', '.probe');
createFixture(scratch, 'nested/../.probe');`;
		expect(transientSourceProducers(source)).toEqual([]);
	});

	it('reports a rest spread whose segments the scan never read', () => {
		const source = `${CHECKOUT_ROOT}
${PARKED}
${REST_HELPER}
const below = JSON.parse(readFileSync(manifest, 'utf8')).segments;
createFixture(scratch, ...below);`;
		expect(transientSourceProducers(source)).toEqual([6, 7]);
	});

	it('reports an ordinary parameter whose value the scan never read', () => {
		const source = `${CHECKOUT_ROOT}
${PARKED}
${SEGMENT_HELPER}
const up = readFileSync(manifest, 'utf8').trim();
createFixture(scratch, up, '.probe');`;
		expect(transientSourceProducers(source)).toEqual([6, 7]);
	});

	it('reports a dynamic name joined straight onto scratch', () => {
		const source = `${CHECKOUT_ROOT}
${PARKED}
const directory = path.join(scratch, suffix);
mkdirSync(directory, { recursive: true });
writeFileSync(path.join(scratch, \`\${suffix}\`), 'safe');`;
		expect(transientSourceProducers(source)).toEqual([5, 6]);
	});

	it('reports a fixed prefix in front of an interpolation it never read', () => {
		const source = [
			CHECKOUT_ROOT,
			PARKED,
			'mkdirSync(path.join(scratch, `scan-probe-${suffix}`), { recursive: true });',
			'rmSync(path.join(scratch, `scan-probe-${buildName()}`), { recursive: true });'
		].join('\n');
		expect(transientSourceProducers(source)).toEqual([4, 5]);
	});

	it('reports a traversal spelled in either separator behind a fixed prefix', () => {
		const source = [
			CHECKOUT_ROOT,
			PARKED,
			'mkdirSync(path.join(scratch, `scan-probe-${hex}/../../.probe`));',
			'mkdirSync(path.join(scratch, `scan-probe-${hex}\\\\..\\\\..\\\\.probe`));'
		].join('\n');
		expect(transientSourceProducers(source)).toEqual([4, 5]);
	});

	it('accepts a randomized child that cannot climb out of scratch', () => {
		const source = `${CHECKOUT_ROOT}
${PARKED}
const probe = path.join(scratch, \`scan-probe-\${randomBytes(6).toString('hex')}\`);
mkdirSync(probe, { recursive: true });
const owned = path.join(scratch, \`probe-\${process.pid}\`);
mkdirSync(owned, { recursive: true });
const temporary = mkdtempSync(path.join(scratch, 'probe-'));
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

	it('reports a fixture parked in the former fixture root', () => {
		const source = `${CHECKOUT_ROOT}
${PARKED}
const directory = path.join(fixtureRoot, '.probe');
const temporary = mkdtempSync(path.join(fixtureRoot, 'probe-'));
mkdirSync(directory, { recursive: true });
writeFileSync(path.join(temporary, 'instructions.md'), 'safe');
rmSync(directory, { recursive: true, force: true });`;
		expect(transientSourceProducers(source)).toEqual([5, 6, 7, 8]);
	});

	it('leaves a throwaway checkout under tmpdir() alone', () => {
		const source = `${CHECKOUT_ROOT}
const checkout = mkdtempSync(path.join(tmpdir(), 'probe-'));
mkdirSync(path.join(checkout, 'src', 'lib'), { recursive: true });
writeFileSync(path.join(checkout, 'src', 'good.ts'), 'source');`;
		expect(transientSourceProducers(source)).toEqual([]);
	});

	// Reads every committed test file and parses the ones `mayProduce` keeps (136 of 1,102 on
	// 2026-11-13). A loaded CI shard runs it several times slower than a local run.
	it('finds no statically anchored producer in the repository', { timeout: 30_000 }, () => {
		const offenders: string[] = [];
		let scanned = 0;

		const files = testFiles();
		for (const file of files) {
			scanned += 1;
			const source = readFileSync(path.join(ROOT, file), 'utf8');
			for (const line of transientSourceProducers(source, file)) offenders.push(`${file}:${line}`);
		}

		// Without this a scan over an empty list reports a clean repository, which is how an
		// exclusion stops protecting anything without failing anything.
		expect(scanned, 'Git listed no test sources; the scan examined nothing.').toBeGreaterThan(0);
		expect(
			offenders,
			'Write these into a private checkout from scripts/__fixtures__/static-checks/private-checkout.ts, or a tree under tmpdir() when no checkout is needed. Lint a path that need not exist with ESLint#lintText(code, { filePath }). In the shared checkout only scratch/ and node_modules/ take throwaway files.'
		).toEqual([]);
	});
});
