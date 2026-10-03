/**
 * ESLint rule: no-test-in-loop
 *
 * Flags a Vitest declaration (`it`, `test`, `describe`, `suite`, including
 * modifier chains, `.skipIf(cond)` / `.runIf(cond)` builders, and the call
 * returned by `.each(rows)` or `.for(rows)`) made inside a `for`, `for...of`,
 * or `for...in` loop.
 *
 * Why: a declaration inside a loop is a hand-built parameterization. The
 * case list, the name template, and the test body are mixed into control
 * flow, so a reader has to execute the loop in their head to know which
 * tests exist. `it.each` / `describe.each` state the same cases as data next
 * to one name template. Vitest still registers one test per row either way;
 * this is a convention, not a reporting change.
 *
 * The walk stops at the nearest function, so a loop inside a test body is
 * fine, and an outer loop around `describe(..., () => { it(...) })` reports
 * only the `describe`. Building the case array with a loop is fine too. Files
 * that load `node:test` are skipped because that runner has no `.each`, and a
 * root bound to a local function or parameter is a helper, not the runner.
 *
 * ❌ for (const code of codes) it(`maps ${code}`, () => { ... });
 * ✅ it.each(codes)('maps %s', (code) => { ... });
 * ✅ const cases = []; for (const page of pages) cases.push([page.name, page]);
 *    it.each(cases)('%s', (_name, page) => { ... });
 */

const ROOTS = new Set(['it', 'test', 'describe', 'suite']);
const MODIFIERS = new Set(['only', 'skip', 'todo', 'concurrent', 'sequential', 'fails', 'shuffle']);
// Calls that return a declaration function instead of declaring anything.
const BUILDERS = new Set(['each', 'for', 'skipIf', 'runIf']);
const LOOPS = new Set(['ForStatement', 'ForOfStatement', 'ForInStatement']);
const FUNCTIONS = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration']);

function propertyName(member) {
	if (member?.type !== 'MemberExpression' || member.computed) return undefined;
	return member.property?.type === 'Identifier' ? member.property.name : undefined;
}

/** Returns the root identifier when `expression` yields a declaration function. */
function declarationRoot(expression) {
	if (expression?.type === 'Identifier') {
		return ROOTS.has(expression.name) ? expression : undefined;
	}
	if (expression?.type === 'MemberExpression') {
		return MODIFIERS.has(propertyName(expression)) ? declarationRoot(expression.object) : undefined;
	}
	if (expression?.type === 'CallExpression') {
		return BUILDERS.has(propertyName(expression.callee))
			? declarationRoot(expression.callee.object)
			: undefined;
	}
	if (expression?.type === 'TaggedTemplateExpression') {
		return BUILDERS.has(propertyName(expression.tag))
			? declarationRoot(expression.tag.object)
			: undefined;
	}
	return undefined;
}

const isFunction = (node) => FUNCTIONS.has(node?.type);

/** True when `identifier` resolves to a local helper such as `const test = (v) => ...`. */
function isLocalHelper(sourceCode, identifier) {
	const reference = sourceCode
		.getScope(identifier)
		.references.find((candidate) => candidate.identifier === identifier);
	return (reference?.resolved?.defs ?? []).some(
		(def) =>
			def.type === 'Parameter' ||
			def.type === 'FunctionName' ||
			(def.type === 'Variable' && isFunction(def.node.init))
	);
}

const NODE_TEST = 'node:test';

/** True when `node` loads `node:test` through import(), require(), or a static import. */
function loadsNodeTest(node) {
	if (node.type === 'ImportDeclaration' || node.type === 'ImportExpression') {
		return node.source?.value === NODE_TEST;
	}
	return (
		node.type === 'CallExpression' &&
		node.callee.type === 'Identifier' &&
		node.callee.name === 'require' &&
		node.arguments[0]?.value === NODE_TEST
	);
}

/** True when `node` runs once per iteration of a loop in its own function. */
function isInsideLoop(node) {
	let child = node;
	for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
		if (isFunction(parent)) return false;
		if (!LOOPS.has(parent.type)) continue;
		// The iterable of for...of / for...in and the initializer of for run once.
		if (child === parent.right || child === parent.init) continue;
		return true;
	}
	return false;
}

export default {
	meta: {
		type: 'suggestion',
		docs: {
			description: 'Disallow declaring Vitest tests or suites inside loops'
		},
		schema: [],
		messages: {
			testInLoop:
				"Declare parameterized {{kind}} with `{{root}}.each(cases)('name %s', ...)` instead of calling `{{root}}` inside a loop; build the case list with the loop if needed."
		}
	},
	create(context) {
		let usesNodeTest = false;
		const pending = [];
		// The runner can be loaded anywhere in the file, so report at the end.
		const noteNodeTest = (node) => {
			usesNodeTest ||= loadsNodeTest(node);
		};
		return {
			ImportDeclaration: noteNodeTest,
			ImportExpression: noteNodeTest,
			CallExpression(node) {
				noteNodeTest(node);
				const callee = node.callee;
				// `test.each(rows)` and `test.skipIf(c)` only build the function that the
				// enclosing call invokes; report that terminal call instead.
				if (BUILDERS.has(propertyName(callee))) return;
				const root = declarationRoot(callee);
				if (!root || !isInsideLoop(node) || isLocalHelper(context.sourceCode, root)) return;
				pending.push({ node, root: root.name });
			},
			'Program:exit'() {
				if (usesNodeTest) return;
				for (const { node, root } of pending) {
					context.report({
						node,
						messageId: 'testInLoop',
						data: { root, kind: root === 'describe' || root === 'suite' ? 'suites' : 'tests' }
					});
				}
			}
		};
	}
};
