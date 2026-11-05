/**
 * ESLint rule: no-raw-caught-error-log
 *
 * Flags a `console.*` call in server code whose arguments reference a caught
 * error: the binding of a `catch` clause, the parameter of a `.catch(...)`
 * callback or of the rejection callback in `.then(onFulfilled, onRejected)`,
 * or a `const` alias of one of those. Any reference counts, so the error inside
 * an object, an array, a template string or a member access (`error.message`)
 * is flagged too.
 *
 * Why: the server console ends up in a log store. A caught error's message, its
 * cause chain and a request path printed beside it can carry user input,
 * provider responses or a password-reset token. `reportRecoveredFailure` writes
 * one line of fixed fields and hands the full error to Sentry; a rethrown error
 * reaches `handleError`, which does the same.
 *
 * The rule follows bindings, not names, so a shadowed `error` or a local
 * `console` is not flagged. An error stored in an outer `let` and logged later
 * is out of its reach.
 *
 * ❌ catch (error) { console.error('[load] Lookup failed:', error); }
 * ✅ catch (error) { reportRecoveredFailure('[load] Lookup failed', error); }
 */

const TS_WRAPPERS = new Set([
	'TSAsExpression',
	'TSSatisfiesExpression',
	'TSNonNullExpression',
	'TSTypeAssertion'
]);

function unwrap(node) {
	let current = node;
	while (current && TS_WRAPPERS.has(current.type)) current = current.expression;
	return current;
}

function findVariable(scope, name) {
	for (let current = scope; current; current = current.upper) {
		const variable = current.set.get(name);
		if (variable) return variable;
	}
	return null;
}

// Type-only children: a binding named there is no runtime value.
const TYPE_KEYS = new Set([
	'typeAnnotation',
	'typeArguments',
	'typeParameters',
	'returnType',
	'superTypeArguments'
]);

// Nodes whose non-computed `key` is a name, not a reference to a binding.
const NAMED_MEMBERS = new Set([
	'Property',
	'MethodDefinition',
	'PropertyDefinition',
	'AccessorProperty',
	'TSAbstractMethodDefinition',
	'TSAbstractPropertyDefinition'
]);

// Whether `fn`, through any cast, is the rejection callback of
// `<promise>.catch(fn)` or `<promise>.then(_, fn)`.
function isRejectionCallback(fn) {
	let argument = fn;
	while (argument.parent && TS_WRAPPERS.has(argument.parent.type)) argument = argument.parent;
	const call = argument.parent;
	if (call?.type !== 'CallExpression') return false;
	const callee = unwrap(call.callee);
	if (callee?.type !== 'MemberExpression') return false;
	const { property, computed } = callee;
	const method = computed ? property.type === 'Literal' && property.value : property.name;
	const position = call.arguments.indexOf(argument);
	return (method === 'catch' && position === 0) || (method === 'then' && position === 1);
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow printing a caught error to the console in server code'
		},
		schema: [],
		messages: {
			rawCaughtError:
				'Report a caught server error with reportRecoveredFailure(label, error) from #lib/server/recovered-failure.js, or rethrow it so handleError reports it. console.* prints the raw error, whose message, cause and request path can carry user input or tokens.'
		}
	},
	create(context) {
		const { sourceCode } = context;
		const visitorKeys = sourceCode.visitorKeys;

		function isCaughtVariable(variable, seen = new Set()) {
			if (!variable || seen.has(variable)) return false;
			seen.add(variable);
			const [definition] = variable.defs;
			if (!definition) return false;
			if (definition.type === 'CatchClause') return true;
			if (definition.type === 'Parameter') {
				// The rejection reason is the first parameter, destructured or not.
				const fn = definition.node;
				const [first] = fn.params;
				return (
					first !== undefined &&
					definition.name.range[0] >= first.range[0] &&
					definition.name.range[1] <= first.range[1] &&
					isRejectionCallback(fn)
				);
			}
			if (
				definition.type === 'Variable' &&
				definition.parent?.kind === 'const' &&
				definition.node.id.type === 'Identifier'
			) {
				const init = unwrap(definition.node.init);
				if (init?.type !== 'Identifier') return false;
				return isCaughtVariable(findVariable(sourceCode.getScope(init), init.name), seen);
			}
			return false;
		}

		function referencesCaughtError(node) {
			if (!node || typeof node !== 'object') return false;
			if (node.type === 'Identifier') {
				return isCaughtVariable(findVariable(sourceCode.getScope(node), node.name));
			}
			for (const key of visitorKeys[node.type] ?? []) {
				if (TYPE_KEYS.has(key)) continue;
				// A property name is no reference to a binding.
				if (key === 'property' && node.type === 'MemberExpression' && !node.computed) continue;
				if (key === 'key' && NAMED_MEMBERS.has(node.type) && !node.computed && !node.shorthand) {
					continue;
				}
				const child = node[key];
				const children = Array.isArray(child) ? child : [child];
				if (children.some((entry) => referencesCaughtError(entry))) return true;
			}
			return false;
		}

		function isGlobalConsole(node) {
			const callee = unwrap(node);
			if (callee?.type !== 'MemberExpression') return false;
			const object = unwrap(callee.object);
			if (object?.type !== 'Identifier' || object.name !== 'console') return false;
			const variable = findVariable(sourceCode.getScope(object), 'console');
			// An implicit global has no definition; a local `console` does.
			return !variable || variable.defs.length === 0;
		}

		return {
			CallExpression(node) {
				if (!isGlobalConsole(node.callee)) return;
				if (node.arguments.some((argument) => referencesCaughtError(argument))) {
					context.report({ node, messageId: 'rawCaughtError' });
				}
			}
		};
	}
};
