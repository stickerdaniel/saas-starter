/**
 * ESLint rule: no-focused-test
 *
 * Flags focused declarations in Vitest and Playwright tests: `.only` on `it`,
 * `test`, `describe`, or `suite`, including modifier chains such as
 * `it.concurrent.only`, `test.describe.serial.only`, and `it.only.each(rows)`.
 * A root imported under another name (`import { test as setup }`) or a fixture
 * built with `test.extend()` and bound to one of those names counts too.
 *
 * Why: a focused test runs alone and silently skips every other test in its
 * file. Vitest (`allowOnly`) and Playwright (`forbidOnly`) reject it only when
 * `CI` is set, so locally the run passes and the mistake surfaces after the push.
 *
 * ❌ it.only('renders the empty state', () => { ... });
 * ❌ test.describe.only('checkout', () => { ... });
 * ✅ it('renders the empty state', () => { ... }); run it alone with `vitest -t`
 * ✅ test('checkout', ...); run it alone with `playwright test --grep checkout`
 */

const ROOTS = new Set(['it', 'test', 'describe', 'suite']);
// Members that keep a declaration chain going, including Playwright's test.describe.
const MODIFIERS = new Set([
	'skip',
	'todo',
	'concurrent',
	'sequential',
	'fails',
	'shuffle',
	'describe',
	'serial',
	'parallel'
]);
const BUILDERS = new Set(['skipIf', 'runIf']);

/** The member name of `x.name` or `x['name']`, undefined for anything else. */
function propertyName(member) {
	if (member?.type !== 'MemberExpression') return undefined;
	const { computed, property } = member;
	if (computed) return typeof property?.value === 'string' ? property.value : undefined;
	return property?.type === 'Identifier' ? property.name : undefined;
}

/** True when `identifier` names a test runner directly or through an import alias. */
function isRunner(sourceCode, identifier) {
	if (ROOTS.has(identifier.name)) return true;
	const reference = sourceCode
		.getScope(identifier)
		.references.find((candidate) => candidate.identifier === identifier);
	return (reference?.resolved?.defs ?? []).some(
		(def) =>
			def.type === 'ImportBinding' &&
			def.node.type === 'ImportSpecifier' &&
			ROOTS.has(def.node.imported?.name ?? def.node.imported?.value)
	);
}

/** True when `expression` evaluates to a test or suite declaration function. */
function isDeclaration(sourceCode, expression) {
	if (expression?.type === 'Identifier') return isRunner(sourceCode, expression);
	if (expression?.type === 'MemberExpression') {
		return MODIFIERS.has(propertyName(expression)) && isDeclaration(sourceCode, expression.object);
	}
	if (expression?.type === 'CallExpression') {
		return (
			BUILDERS.has(propertyName(expression.callee)) &&
			isDeclaration(sourceCode, expression.callee.object)
		);
	}
	return false;
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow focused tests (`.only`) in unit and E2E test files'
		},
		schema: [],
		messages: {
			focusedTest:
				'Remove `.only`: a focused test silently skips the rest of its file, and only CI rejects it. Run one test locally with `vitest -t <name>` or `playwright test --grep <name>` instead.'
		}
	},
	create(context) {
		return {
			MemberExpression(node) {
				if (propertyName(node) !== 'only') return;
				if (!isDeclaration(context.sourceCode, node.object)) return;
				context.report({ node: node.property, messageId: 'focusedTest' });
			}
		};
	}
};
