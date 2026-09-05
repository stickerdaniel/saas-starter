// Two source shapes carry the theme reveal, and neither survives in a type.
//
// The origin writes have to stand as plain statements inside the fulfillment
// callback of `transition.ready`. Written before the transition starts, or
// deferred past readiness, they resolve the viewport pixels against the wrong
// snapshot coordinate space and the circle opens away from the toggle.
//
// The root marker has to be cleared by the transition that set it and no other:
// a transition finishing after a second toggle has started otherwise strips the
// mark that second reveal runs under. So the cleanup hangs off the `finished`
// promise of that same transition, the one settlement a successful reveal
// reaches, and removes an attribute only while it still holds its own token.
//
// Every call is pinned to `document.documentElement`, since the same method on
// another element leaves the real root untouched. Local names, function form and
// the arithmetic behind a coordinate stay outside the contract, so this is read
// off the AST rather than matched as text.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const COMPONENT = join(process.cwd(), 'src/lib/components/ui/light-switch/light-switch.svelte');
const MARKER = 'data-theme-transition';
const REVEAL_X = '--view-transition-x';
const REVEAL_Y = '--view-transition-y';
const ROOT = 'document.documentElement';
const ROOT_STYLE = `${ROOT}.style`;

// Calls whose value differs per transition. A deterministic one such as
// `String('theme')` hands every toggle the same token, so an older transition
// would recognize a newer toggle's marker as its own and clear it.
const ENTROPY = new Set(['crypto.randomUUID', 'Math.random', 'Date.now', 'performance.now']);

// DOMRect reads. A coordinate taken from the pointer event instead of the
// toggle rect names none of these and stays unclassified.
const HORIZONTAL = new Set(['left', 'right', 'width', 'x']);
const VERTICAL = new Set(['top', 'bottom', 'height', 'y']);

type Axis = 'horizontal' | 'vertical';

/** Every node under `root`, so a caller can narrow it with a TypeScript type guard. */
function nodes(root: ts.Node): ts.Node[] {
	const found: ts.Node[] = [];
	const visit = (current: ts.Node): void => {
		found.push(current);
		ts.forEachChild(current, visit);
	};
	visit(root);
	return found;
}

/** A plain dotted chain as `"foo.bar"`, or undefined once a link is computed. */
function path(node: ts.Node | undefined): string | undefined {
	if (!node) return undefined;
	if (ts.isIdentifier(node)) return node.text;
	if (!ts.isPropertyAccessExpression(node)) return undefined;
	const object = path(node.expression);
	return object === undefined ? undefined : `${object}.${node.name.text}`;
}

function identifier(node: ts.Node | undefined): string | undefined {
	return node && ts.isIdentifier(node) ? node.text : undefined;
}

function literal(node: ts.Node | undefined): string | undefined {
	return node && ts.isStringLiteralLike(node) ? node.text : undefined;
}

/** The method of `a.b.c()`, which is `"c"`. A bare `c()` has none. */
function method(call: ts.CallExpression): string | undefined {
	return ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : undefined;
}

/** The receiver of `a.b.c()`, which is `"a.b"`. This is what pins a call to the root. */
function receiver(call: ts.CallExpression): string | undefined {
	return ts.isPropertyAccessExpression(call.expression)
		? path(call.expression.expression)
		: undefined;
}

function argument(node: ts.Node | undefined, index: number): ts.Node | undefined {
	return node && ts.isCallExpression(node) ? node.arguments[index] : undefined;
}

/** The interpolated expression of a `` `${…}px` `` template, so a bare number fails. */
function pixels(node: ts.Node | undefined): ts.Node | undefined {
	if (!node || !ts.isTemplateExpression(node) || node.head.text !== '') return undefined;
	const [span, ...rest] = node.templateSpans;
	return span && rest.length === 0 && span.literal.text === 'px' ? span.expression : undefined;
}

/**
 * The innermost function that runs a node. Enclosing one is not running it: an
 * outer function that only defines an inner one holding the clear never removes
 * the marker, so the innermost function is the only runner.
 */
function runner(node: ts.Node): ts.Node | undefined {
	for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
		if (ts.isArrowFunction(at) || ts.isFunctionExpression(at) || ts.isFunctionDeclaration(at)) {
			return at;
		}
	}
	return undefined;
}

/** The `if` whose then-branch holds this node, so a comparison elsewhere proves nothing. */
function branchOver(node: ts.Node): ts.IfStatement | undefined {
	for (let at: ts.Node = node; at.parent; at = at.parent) {
		if (ts.isIfStatement(at.parent) && at.parent.thenStatement === at) return at.parent;
	}
	return undefined;
}

function analyze(source: string) {
	const file = ts.createSourceFile('h.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const all = nodes(file);
	const calls = all.filter(ts.isCallExpression);
	const declarations = all.filter(ts.isVariableDeclaration);

	/** What a name refers to: a declarator's initializer, or a function declaration. */
	const bindingOf = (name: string): ts.Node | undefined =>
		declarations.find((declaration) => identifier(declaration.name) === name)?.initializer ??
		all.filter(ts.isFunctionDeclaration).find((declared) => declared.name?.text === name);

	/** The single name bound to a matching call, whatever the source happens to call it. */
	const boundTo = (matches: (call: ts.CallExpression) => boolean): string | undefined => {
		const found = declarations.filter(
			(declaration) =>
				declaration.initializer &&
				ts.isCallExpression(declaration.initializer) &&
				matches(declaration.initializer)
		);
		return found.length === 1 ? identifier(found[0]!.name) : undefined;
	};

	const transition = boundTo((call) => path(call.expression) === 'document.startViewTransition');
	const rect = boundTo((call) => method(call) === 'getBoundingClientRect');

	/** Calls registering a handler on one promise of the transition, however named. */
	const handlersOn = (promise: string, methods: string[]) =>
		calls.filter(
			(call) =>
				transition !== undefined &&
				methods.includes(method(call) ?? '') &&
				receiver(call) === `${transition}.${promise}`
		);

	const markerCalls = (name: string) =>
		calls.filter(
			(call) =>
				method(call) === name && receiver(call) === ROOT && literal(argument(call, 0)) === MARKER
		);

	const revealWrites = calls.filter(
		(call) =>
			method(call) === 'setProperty' &&
			receiver(call) === ROOT_STYLE &&
			[REVEAL_X, REVEAL_Y].includes(literal(argument(call, 0)) ?? '')
	);

	const readyThens = handlersOn('ready', ['then']);
	const handler = readyThens.length === 1 ? argument(readyThens[0], 0) : undefined;
	const inline =
		handler && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))
			? handler
			: undefined;

	// The statements the fulfillment callback runs itself. A write reached through
	// a nested promise, an inner function, a timer, rAF or queueMicrotask sits in
	// some other body and is absent here, whatever that wrapper is called.
	const direct = new Set<ts.Node>(
		inline && ts.isBlock(inline.body)
			? inline.body.statements.filter(ts.isExpressionStatement).map((node) => node.expression)
			: []
	);

	/** The axis an expression reads, counting reads of the toggle rect and nothing else. */
	const axisOf = (value: ts.Node | undefined): Axis | undefined => {
		const read = value && ts.isIdentifier(value) ? bindingOf(value.text) : value;
		if (!read || rect === undefined) return undefined;
		const axes = nodes(read)
			.filter(ts.isPropertyAccessExpression)
			.filter((access) => identifier(access.expression) === rect)
			.flatMap<Axis>((access) => {
				if (HORIZONTAL.has(access.name.text)) return ['horizontal'];
				return VERTICAL.has(access.name.text) ? ['vertical'] : [];
			});
		return axes.length > 0 && axes.every((axis) => axis === axes[0]) ? axes[0] : undefined;
	};

	const marks = markerCalls('setAttribute');
	const mark = marks.length === 1 ? identifier(argument(marks[0], 1)) : undefined;
	const clears = markerCalls('removeAttribute');

	/** Whether a test reads the live marker back and compares it with the mark just set. */
	const comparesOwnMark = (test: ts.Expression): boolean => {
		if (mark === undefined || !ts.isBinaryExpression(test)) return false;
		if (test.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) return false;
		return (
			[test.left, test.right].some((side) => identifier(side) === mark) &&
			[test.left, test.right].some(
				(side) =>
					ts.isCallExpression(side) &&
					method(side) === 'getAttribute' &&
					receiver(side) === ROOT &&
					literal(argument(side, 0)) === MARKER
			)
		);
	};

	const guardedClears = clears.filter((clear) => {
		const branch = branchOver(clear);
		return branch !== undefined && comparesOwnMark(branch.expression);
	});
	const clearRunners = new Set(guardedClears.map(runner).filter((node) => node !== undefined));

	// Handling rejection alone leaves the marker on the root of every transition
	// that succeeds, so the cleanup has to sit in the slot `finished` calls on
	// success: the fulfillment argument of `then`, or the argument of `finally`.
	const clearsOnFinish = handlersOn('finished', ['then', 'finally']).some((call) => {
		const cleanup = argument(call, 0);
		const name = identifier(cleanup);
		const target = name === undefined ? cleanup : bindingOf(name);
		return target !== undefined && clearRunners.has(target);
	});

	/** Whether an initializer mints a per-transition value on every branch it can take. */
	const mints = (value: ts.Node | undefined): boolean => {
		if (!value) return false;
		if (ts.isConditionalExpression(value)) return mints(value.whenTrue) && mints(value.whenFalse);
		return nodes(value)
			.filter(ts.isCallExpression)
			.some((call) => ENTROPY.has(path(call.expression) ?? ''));
	};

	return {
		syncFulfillment:
			inline !== undefined &&
			!inline.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword),
		revealWrites: revealWrites.length,
		// Reveal property to the axis it reads, for the writes the fulfillment
		// callback runs itself. A deferred or non-pixel write has no entry.
		revealOrigins: new Map(
			revealWrites
				.filter((write) => direct.has(write))
				.map((write) => [literal(argument(write, 0)), axisOf(pixels(argument(write, 1)))])
		),
		mintsMark: mark !== undefined && mints(bindingOf(mark)),
		clearsOwnMarkOnly: clears.length > 0 && guardedClears.length === clears.length,
		clearsOnFinish
	};
}

const source = readFileSync(COMPONENT, 'utf8');
const component = analyze(source.match(/<script lang="ts">([\s\S]*?)<\/script>/)?.[1] ?? '');

const RECT_ORIGINS =
	'\nconst originX = box.left + box.width / 2;\nconst originY = box.top + box.height / 2;\n';
const POINTER_ORIGINS = '\nconst originX = event.x;\nconst originY = event.y;\n';
const FALLBACK_MARK =
	"typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`";

/** Both reveal writes against a receiver, so a wrong element can take the root's place. */
const writes = (root: string) => `
	${root}.style.setProperty('${REVEAL_X}', \`\${originX}px\`);
	${root}.style.setProperty('${REVEAL_Y}', \`\${originY}px\`);
`;

/** The guarded clear as a bare statement, so a fixture can bury it in an inner function. */
const guardedClear = (root: string) =>
	`if (${root}.getAttribute('${MARKER}') === token) ${root}.removeAttribute('${MARKER}');`;

const DEFAULTS = {
	origins: RECT_ORIGINS,
	ready: `() => {${writes(ROOT)}}`,
	root: ROOT,
	mark: 'crypto.randomUUID()',
	cleanup: (root: string) => `const clear = () => { ${guardedClear(root)} };`,
	finished: 'transition.finished.then(clear, clear);'
};

/** The handler reduced to its transition wiring, with every guarded shape overridable. */
function fixture(overrides: Partial<typeof DEFAULTS> = {}) {
	const { origins, ready, root, mark, cleanup, finished } = { ...DEFAULTS, ...overrides };
	return analyze(`
		const box = element.getBoundingClientRect();
		${origins}
		const token = ${mark};
		${root}.setAttribute('${MARKER}', token);
		const transition = document.startViewTransition(() => toggleMode());
		${cleanup(root)}
		transition.ready.then(${ready}, clear);
		${finished}
	`);
}

describe('light switch reveal origin', () => {
	it('writes both origins as plain statements of the transition.ready callback', () => {
		expect(component.syncFulfillment).toBe(true);
		expect(component.revealWrites).toBe(2);
		expect(component.revealOrigins.get(REVEAL_X)).toBe('horizontal');
		expect(component.revealOrigins.get(REVEAL_Y)).toBe('vertical');
	});

	it('rejects origins written outside the ready callback', () => {
		const early = fixture({ origins: RECT_ORIGINS + writes(ROOT), ready: '() => {}' });
		expect(early.revealWrites).toBe(2);
		expect(early.revealOrigins.size).toBe(0);

		const nested = fixture({ ready: `() => { Promise.resolve().then(() => {${writes(ROOT)}}); }` });
		expect(nested.revealWrites).toBe(2);
		expect(nested.revealOrigins.size).toBe(0);

		const awaited = fixture({ ready: `async () => { await Promise.resolve();${writes(ROOT)}}` });
		expect(awaited.syncFulfillment).toBe(false);
	});

	it('rejects origins taken from the pointer instead of the toggle rect', () => {
		const pointer = fixture({ origins: POINTER_ORIGINS });
		expect(pointer.revealOrigins.get(REVEAL_X)).toBeUndefined();
		expect(pointer.revealOrigins.get(REVEAL_Y)).toBeUndefined();
	});

	it('rejects origin writes made on an element other than the document root', () => {
		const detached = fixture({ ready: `() => {${writes('element')}}` });
		expect(detached.revealWrites).toBe(0);
		expect(detached.revealOrigins.size).toBe(0);
	});
});

describe('light switch transition marker', () => {
	it('mints a marker per transition and clears only the one it set', () => {
		expect(component.mintsMark).toBe(true);
		expect(component.clearsOwnMarkOnly).toBe(true);
		expect(component.clearsOnFinish).toBe(true);
	});

	it('accepts equivalent wiring under its own names and function forms', () => {
		const renamed = fixture({ ready: `function () {${writes(ROOT)}}` });
		expect(renamed.revealOrigins.get(REVEAL_X)).toBe('horizontal');
		expect(renamed.revealOrigins.get(REVEAL_Y)).toBe('vertical');
		expect(renamed.mintsMark).toBe(true);
		expect(renamed.clearsOwnMarkOnly).toBe(true);
		expect(renamed.clearsOnFinish).toBe(true);

		expect(fixture({ mark: FALLBACK_MARK }).mintsMark).toBe(true);
		expect(fixture({ finished: 'transition.finished.finally(clear);' }).clearsOnFinish).toBe(true);
		const bare = fixture({
			finished: `transition.finished.then(() => { ${guardedClear(ROOT)} });`
		});
		expect(bare.clearsOnFinish).toBe(true);
	});

	it('rejects a marker any later transition could clear', () => {
		const constant = fixture({ mark: "String('theme')" });
		expect(constant.mintsMark).toBe(false);
		expect(constant.clearsOwnMarkOnly).toBe(true);

		const unguarded = fixture({
			cleanup: (root) => `const clear = () => { ${root}.removeAttribute('${MARKER}'); };`
		});
		expect(unguarded.clearsOwnMarkOnly).toBe(false);
	});

	it('rejects a cleanup left off the finished promise of its own transition', () => {
		const rejectionOnly = fixture({ finished: '' });
		expect(rejectionOnly.clearsOwnMarkOnly).toBe(true);
		expect(rejectionOnly.clearsOnFinish).toBe(false);
	});

	it('rejects a cleanup that only defines the guarded clear in an inner function', () => {
		const named = fixture({
			cleanup: (root) => `const clear = () => { const actual = () => { ${guardedClear(root)} }; };`
		});
		expect(named.clearsOwnMarkOnly).toBe(true);
		expect(named.clearsOnFinish).toBe(false);

		const bare = fixture({
			cleanup: () => 'const clear = () => {};',
			finished: `transition.finished.then(() => { const actual = () => { ${guardedClear(ROOT)} }; });`
		});
		expect(bare.clearsOnFinish).toBe(false);
	});

	it('rejects marker calls made on an element other than the document root', () => {
		const detached = fixture({ root: 'element' });
		expect(detached.mintsMark).toBe(false);
		expect(detached.clearsOwnMarkOnly).toBe(false);
		expect(detached.clearsOnFinish).toBe(false);
	});
});
