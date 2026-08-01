// convex-vite-plugin prints every value it hands the local Convex backend, plus
// the backend's generated instance secret and admin key, straight to the dev
// console (upstream: juliusmarminge/agent-tools#24). It also passes
// --instance-secret in argv with no 'error' listener on the child, so a failed
// exec makes Node print the whole error object, spawnargs included. All four are
// closed by patches/convex-vite-plugin@0.4.0.patch.
//
// These assertions read the *installed* artifacts rather than the patch file,
// because three things can go wrong silently: the patch is not registered, it
// fails to apply on install, or a dependency upgrade moves the code out from
// under it. The plugin's `exports["."]` resolves to dist/index.mjs and it has no
// `main`, so a patch that only touched src/ would change nothing at runtime.
//
// The bundles are parsed rather than pattern-matched. Substring and line-wise
// checks pass against a reworded log, a call whose argument sits on the next
// line, and forms like `logger.info(name + value)` — exactly the drift a guard
// on a patched dependency exists to catch.
//
// It is a syntactic guard, not taint analysis, and the difference is worth
// knowing before trusting it further than it goes. It recognises a logger by
// shape (`<something ending in logger>.info|warn|error`), so an alias, a
// destructured `const { info } = logger`, a computed `logger['info']` or a
// bundler rename would slip past, and it matches identifier names rather than
// values, so `const s = this.instanceSecret; logger.info(s)` would too. That is
// acceptable here only because the dependency is pinned to an exact version and
// this guards a patch against it: the realistic failure is that patch decaying,
// not the package growing a laundering path.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const entry = require.resolve('convex-vite-plugin');

/**
 * The backend chunk's filename is content-hashed, so it is followed from the
 * entry's own import rather than matched by prefix. Picking the first
 * `backend-*.mjs` in the directory would inspect a stale or secondary chunk if a
 * release ever shipped two, and pass while the imported one stayed unpatched.
 */
function backendChunk(): string {
	const imported = fs
		.readFileSync(entry, 'utf-8')
		.match(/from\s+["'](\.\/backend-[^"']+\.mjs)["']/);
	expect(imported?.[1], `no backend chunk imported by ${entry}`).toBeDefined();
	return path.resolve(path.dirname(entry), imported![1]!);
}

function parse(file: string): ts.SourceFile {
	return ts.createSourceFile(
		file,
		fs.readFileSync(file, 'utf-8'),
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS
	);
}

function findCalls(node: ts.Node, keep: (call: ts.CallExpression) => boolean): ts.CallExpression[] {
	const found: ts.CallExpression[] = [];
	const visit = (current: ts.Node): void => {
		if (ts.isCallExpression(current) && keep(current)) found.push(current);
		ts.forEachChild(current, visit);
	};
	visit(node);
	return found;
}

/** `logger.info(...)`, `this.logger.warn(...)`, and friends. */
function isLoggerCall(call: ts.CallExpression): boolean {
	const callee = call.expression;
	return (
		ts.isPropertyAccessExpression(callee) &&
		['info', 'warn', 'error'].includes(callee.name.text) &&
		callee.expression.getText().endsWith('logger')
	);
}

/** Every identifier named anywhere inside a node, however it is composed. */
function identifiersIn(node: ts.Node): Set<string> {
	const names = new Set<string>();
	const visit = (current: ts.Node): void => {
		if (ts.isIdentifier(current)) names.add(current.text);
		ts.forEachChild(current, visit);
	};
	visit(node);
	return names;
}

/**
 * Every use of the binding `name` inside `scope`, excluding its declaration.
 *
 * Member and key positions are not uses of the binding: in `this.logger.error`
 * and `{ error: x }` the identifier merely happens to share the name. Shorthand
 * (`{ error }`) is a real use and is deliberately kept, since that is one of the
 * ways the object escapes.
 */
function referencesTo(scope: ts.Node, declaration: ts.Node, name: string): ts.Identifier[] {
	const uses: ts.Identifier[] = [];
	const visit = (current: ts.Node): void => {
		if (ts.isIdentifier(current) && current.text === name && current !== declaration) {
			const parent = current.parent;
			const isMemberName = ts.isPropertyAccessExpression(parent) && parent.name === current;
			const isKey =
				(ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) &&
				parent.name === current;
			if (!isMemberName && !isKey) uses.push(current);
		}
		ts.forEachChild(current, visit);
	};
	visit(scope);
	return uses;
}

/**
 * Whether a reference to the spawn error is one of the reductions that provably
 * cannot carry `spawnargs`: reading `.message`, `String()` (which goes through
 * `Error.prototype.toString`, i.e. name plus message), or an `instanceof` test.
 * Anything else — a bare argument, object shorthand, `JSON.stringify` — hands on
 * the object itself and has to fail.
 */
function isSafeErrorReduction(reference: ts.Identifier): boolean {
	const parent = reference.parent;
	if (ts.isPropertyAccessExpression(parent) && parent.expression === reference) {
		return parent.name.text === 'message';
	}
	if (
		ts.isBinaryExpression(parent) &&
		parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword
	) {
		return parent.left === reference;
	}
	if (ts.isCallExpression(parent) && parent.expression.getText() === 'String') {
		return parent.arguments.length === 1 && parent.arguments[0] === reference;
	}
	return false;
}

/** Logger calls whose arguments mention any of `banned`, as printable text. */
function loggedSecrets(file: string, banned: string[]): string[] {
	return findCalls(parse(file), isLoggerCall)
		.filter((call) =>
			call.arguments.some((argument) => {
				const names = identifiersIn(argument);
				return banned.some((name) => names.has(name));
			})
		)
		.map((call) => call.getText().replace(/\s+/g, ' ').slice(0, 120));
}

describe('convex-vite-plugin secret logging', () => {
	it('resolves to the bundled entry the plugin actually runs', () => {
		expect(entry).toMatch(/[\\/]dist[\\/]index\.mjs$/);
	});

	it('logs env var names without their values', () => {
		expect(fs.readFileSync(entry, 'utf-8')).toContain(
			'Set environment variable: ${name} = [REDACTED]'
		);
		// Not just the statement we patched: any logger call that reaches the
		// loop's `value` binding, in any form, has to fail here.
		expect(loggedSecrets(entry, ['value'])).toEqual([]);
	});

	it('logs the backend banner without the instance secret or admin key', () => {
		const chunk = backendChunk();
		const source = fs.readFileSync(chunk, 'utf-8');
		expect(source).toContain('Instance secret: [REDACTED]');
		expect(source).toContain('Admin key:       [REDACTED]');
		// Scoped to logger arguments, so the admin key's legitimate use in an
		// Authorization header stays allowed.
		expect(loggedSecrets(chunk, ['instanceSecret', 'adminKey'])).toEqual([]);
	});

	// The spawn carries --instance-secret in argv. Without a listener Node treats
	// a failed exec as an unhandled 'error' event and prints the whole error
	// object, spawnargs included — a leak no logger patch can reach.
	it('handles the backend spawn error without forwarding the error object', () => {
		const source = parse(backendChunk());
		const listeners = findCalls(source, (call) => {
			const callee = call.expression;
			const first = call.arguments[0];
			return (
				ts.isPropertyAccessExpression(callee) &&
				callee.name.text === 'on' &&
				callee.expression.getText().endsWith('this.process') &&
				!!first &&
				ts.isStringLiteralLike(first) &&
				first.text === 'error'
			);
		});
		expect(listeners.length, 'no error listener on the spawned backend process').toBeGreaterThan(0);

		// Every listener, not just the one this patch adds. A second one appearing
		// is not itself a problem, but it would be a new place for the error object
		// to escape, and pinning the count instead would fail on it for no reason.
		for (const listener of listeners) {
			const callback = listener.arguments[1]!;
			expect(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)).toBe(true);
			const parameterNode = (callback as ts.ArrowFunction).parameters[0]!.name;
			const parameter = parameterNode.getText();

			// Every reference to the error, not just the ones handed to a logger.
			// Checking logger arguments alone lets the object escape by the side
			// door: `{ timestamp: true, error }` reaches the package's default
			// logger as `console.error(formatted, options.error)`, and a bare
			// `console.error(JSON.stringify(error))` is not a logger call at all.
			// So each reference must be one of the reductions proven not to carry
			// argv: `.message`, `String()` (Error.prototype.toString is name plus
			// message), or an `instanceof` test, which stringifies nothing.
			const unsafe = referencesTo(callback, parameterNode, parameter).filter(
				(reference) => !isSafeErrorReduction(reference)
			);
			expect(
				unsafe.map((reference) => reference.parent.getText().replace(/\s+/g, ' ').slice(0, 120)),
				'the error object escapes the listener instead of being reduced'
			).toEqual([]);

			const logs = findCalls(callback, isLoggerCall);
			expect(logs.length, 'listener logs nothing, so the failure is silent').toBeGreaterThan(0);
			expect(callback.getText()).toContain(`${parameter}.message`);
		}
	});
});
