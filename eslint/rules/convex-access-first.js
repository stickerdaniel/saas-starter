/**
 * ESLint rule: convex-access-first
 *
 * A public `query`, `mutation` or `action` handler has a block body with a guard
 * statement, and no effect runs before the first one. A guard is a call whose
 * name matches the `pattern` option and that throws on refusal. A guard
 * statement is a top-level statement of the handler body in one of three forms:
 *
 * - `await guard(...);`
 * - `const access = await guard(...);` with exactly one declarator
 * - `guard(...);` for a name on the `synchronous` list
 *
 * A guard call anywhere else, such as an `if` test, a logical expression, a
 * loop, a `try` block or a nested function, is no guard statement, because a
 * path can skip it; so is a call through an optional chain. No effect call
 * stands before the first guard statement, at any depth, and none inside the
 * expression that computes the guard's callee or its arguments: `ctx.db.insert|patch|
 * replace|delete`, `ctx.runMutation`, `ctx.runAction`, `ctx.scheduler.*`,
 * `ctx.storage.store|delete|generateUploadUrl`, and `fetch`. A read or an early
 * exit before the guard stays allowed, because a handler loads the row that
 * names the resource it authorizes. The guard statement is unconditional and
 * nothing before it has an effect, so every path that reaches an effect has run
 * the guard. `local/convex-canonical-registration` keeps every registration in
 * the form this rule reads.
 *
 * Example: handler: async (ctx, args) => { const row = await ctx.db.get(args.id);
 *   await requireOwner(ctx, row); await ctx.db.patch(...); }
 */

const PUBLIC_BUILDERS = new Set(['query', 'mutation', 'action']);
const DB_WRITES = new Set(['insert', 'patch', 'replace', 'delete']);
const STORAGE_WRITES = new Set(['store', 'delete', 'generateUploadUrl']);
const RUNNERS = new Set(['runMutation', 'runAction']);
const TS_WRAPPERS = new Set([
	'TSAsExpression',
	'TSSatisfiesExpression',
	'TSNonNullExpression',
	'TSTypeAssertion',
	'ChainExpression'
]);

const isFunction = (node) =>
	node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression';

function unwrap(node) {
	let result = node;
	while (TS_WRAPPERS.has(result?.type)) result = result.expression;
	return result;
}

/** `insert` for `db.insert`, `db['insert']` and `` db[`insert`] ``; null otherwise. */
function propertyName(node) {
	const member = unwrap(node);
	if (member?.type !== 'MemberExpression') return null;
	const { property } = member;
	if (!member.computed) return property.type === 'Identifier' ? property.name : null;
	if (property.type === 'Literal' && typeof property.value === 'string') return property.value;
	if (property.type === 'TemplateLiteral' && property.expressions.length === 0) {
		return property.quasis[0].value.cooked;
	}
	return null;
}

/** `requireUser` for `requireUser(...)` and `authz.require(...)`; null otherwise. */
function calleeName(call) {
	const callee = unwrap(call.callee);
	return callee.type === 'Identifier' ? callee.name : propertyName(callee);
}

function isEffect(call) {
	const callee = unwrap(call.callee);
	if (callee.type === 'Identifier') return callee.name === 'fetch';
	const method = propertyName(callee);
	if (!method) return false;
	if (RUNNERS.has(method)) return true;
	const owner = propertyName(unwrap(callee).object);
	if (owner === 'db') return DB_WRITES.has(method);
	if (owner === 'storage') return STORAGE_WRITES.has(method);
	return owner === 'scheduler';
}

/** Every call under `node`, nested functions included. */
function collectCalls(node, calls = []) {
	if (!node || typeof node.type !== 'string') return calls;
	if (node.type === 'CallExpression') calls.push(node);
	for (const key of Object.keys(node)) {
		if (key === 'parent') continue;
		const value = node[key];
		for (const child of Array.isArray(value) ? value : [value]) {
			if (child && typeof child.type === 'string') collectCalls(child, calls);
		}
	}
	return calls;
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Require a guard statement before any effect in a public Convex handler'
		},
		schema: [
			{
				type: 'object',
				properties: {
					pattern: { type: 'string' },
					synchronous: { type: 'array', items: { type: 'string' } }
				},
				required: ['pattern'],
				additionalProperties: false
			}
		],
		messages: {
			missingGuard:
				"Start this public handler with a guard statement: `await requireUser(ctx);`, `const access = await requireUser(ctx);`, or a guard on the rule's `synchronous` list such as `publicEndpoint('<reason>');`. A guard inside a condition, logical expression, loop, try block, nested function or multi-declarator statement can be skipped.",
			notAwaited:
				"Await `{{name}}` as its own statement: the handler otherwise runs on before the check completes, and its refusal arrives after the work is done. A guard that throws synchronously belongs on the rule's `synchronous` list.",
			effectBeforeGuard:
				'Run the guard statement before this effect. A refused caller must not change data, schedule work or reach the network; reads that find the resource may stay before the guard.'
		}
	},
	create(context) {
		const { pattern: source, synchronous = [] } = context.options[0];
		const pattern = new RegExp(source);
		const synchronousGuards = new Set(synchronous);

		// An optional chain can skip the call, so `guard?.(ctx)` and `guards?.require(ctx)` are no guard.
		const guardCall = (expression) => {
			let node = expression;
			while (TS_WRAPPERS.has(node?.type) && node.type !== 'ChainExpression') node = node.expression;
			return node?.type === 'CallExpression' && pattern.test(calleeName(node) ?? '') ? node : null;
		};

		/** The guard call of a guard statement, or null for any other statement. */
		function guardOf(statement) {
			if (statement.type === 'ExpressionStatement') {
				const expression = unwrap(statement.expression);
				if (expression.type === 'AwaitExpression') return guardCall(expression.argument);
				const call = guardCall(statement.expression);
				return call && synchronousGuards.has(calleeName(call)) ? call : null;
			}
			if (
				statement.type === 'VariableDeclaration' &&
				statement.kind === 'const' &&
				statement.declarations.length === 1
			) {
				const init = unwrap(statement.declarations[0].init);
				return init?.type === 'AwaitExpression' ? guardCall(init.argument) : null;
			}
			return null;
		}

		return {
			CallExpression(node) {
				if (node.callee.type !== 'Identifier' || !PUBLIC_BUILDERS.has(node.callee.name)) return;
				const config = node.arguments[0] && unwrap(node.arguments[0]);
				if (config?.type !== 'ObjectExpression') return;
				const handlerProperty = config.properties.find(
					(property) =>
						property.type === 'Property' &&
						property.key.type === 'Identifier' &&
						property.key.name === 'handler'
				);
				const handler = handlerProperty && unwrap(handlerProperty.value);
				if (!handler || !isFunction(handler)) return;

				const statements = handler.body.type === 'BlockStatement' ? handler.body.body : [];
				const index = statements.findIndex((statement) => guardOf(statement));
				const before = index === -1 ? statements : statements.slice(0, index);
				for (const statement of before) {
					const call =
						statement.type === 'ExpressionStatement' ? guardCall(statement.expression) : null;
					if (call) {
						context.report({
							node: call,
							messageId: 'notAwaited',
							data: { name: calleeName(call) }
						});
					}
				}
				if (index === -1) {
					context.report({ node: handler, messageId: 'missingGuard' });
					return;
				}
				const guard = guardOf(statements[index]);
				// The callee expression and the arguments both run before the guard itself.
				const checked = [...before, guard.callee, ...guard.arguments].flatMap((node) =>
					collectCalls(node)
				);
				for (const call of checked) {
					if (isEffect(call)) context.report({ node: call, messageId: 'effectBeforeGuard' });
				}
			}
		};
	}
};
