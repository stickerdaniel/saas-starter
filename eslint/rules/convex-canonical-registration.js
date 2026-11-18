/**
 * ESLint rule: convex-canonical-registration
 *
 * Keeps every raw Convex registration in the one form the access rules read.
 * `@convex-dev/require-access-control` finds a registration by the callee
 * names `query`, `mutation`, `action` and an identifier key `handler`, so any
 * other spelling hides a public function from it. The rule requires:
 *
 * - the builders `query`, `mutation`, `action` and their `internal*` forms are
 *   imported from `_generated/server` under their own names, with no namespace
 *   import and no re-export;
 * - a builder binding is only called, without `?.`, or passed to a builder
 *   imported from convex-helpers (`customQuery(query, ...)`);
 * - a registration takes one object literal whose keys are plain identifiers,
 *   with no spread and no computed key;
 * - a public registration has an inline `handler` function.
 *
 * Example: export const f = query({ args: {}, returns: v.null(), handler: async (ctx) => { ... } });
 */

const BUILDERS = new Set([
	'query',
	'mutation',
	'action',
	'internalQuery',
	'internalMutation',
	'internalAction'
]);
const PUBLIC_BUILDERS = new Set(['query', 'mutation', 'action']);

const isGeneratedServer = (source) => /(^|\/)_generated\/server(\.[jt]s)?$/.test(source);

function unwrap(node) {
	let result = node;
	while (
		result.type === 'TSAsExpression' ||
		result.type === 'TSSatisfiesExpression' ||
		result.type === 'TSNonNullExpression' ||
		result.type === 'TSTypeAssertion'
	) {
		result = result.expression;
	}
	return result;
}

/** A builder imported from convex-helpers, such as `customQuery`, takes the raw builder first. */
function isCustomBuilderArgument(identifier, sourceCode) {
	const call = identifier.parent;
	if (
		call?.type !== 'CallExpression' ||
		call.arguments[0] !== identifier ||
		call.callee.type !== 'Identifier'
	) {
		return false;
	}
	for (let scope = sourceCode.getScope(call); scope; scope = scope.upper) {
		const variable = scope.set.get(call.callee.name);
		if (!variable) continue;
		return variable.defs.some(
			(def) => def.type === 'ImportBinding' && /^convex-helpers(\/|$)/.test(def.parent.source.value)
		);
	}
	return false;
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Require the canonical form for raw Convex function registrations'
		},
		schema: [],
		messages: {
			aliasedImport:
				'Import `{{name}}` from _generated/server under its own name. The access rules find registrations by the builder name, so an alias hides a public function from them.',
			namespaceImport:
				'Import the Convex builders from _generated/server by name. The access rules cannot see a registration through a namespace object.',
			reexport:
				'Import `{{name}}` from _generated/server where it registers a function. The access rules cannot see a registration through a re-exported builder.',
			indirectReference:
				'Call `{{name}}` directly, or pass it to a builder imported from convex-helpers. The access rules cannot see a registration through another binding.',
			optionalCall:
				'Call `{{name}}` without `?.`. The access rules do not read a registration inside an optional chain.',
			configShape:
				'Pass `{{name}}` one object literal with plain identifier keys and no spread. The access rules read `handler` only as a plain key of that object.',
			inlineHandler:
				'Write the `handler` of this public `{{name}}` inline as a function. The access rules read the access call inside the handler body.'
		}
	},
	create(context) {
		function checkRegistration(call, name) {
			const config = call.arguments.length === 1 ? unwrap(call.arguments[0]) : null;
			if (
				config?.type !== 'ObjectExpression' ||
				config.properties.some(
					(property) =>
						property.type !== 'Property' || property.computed || property.key.type !== 'Identifier'
				)
			) {
				context.report({ node: call, messageId: 'configShape', data: { name } });
				return;
			}
			if (!PUBLIC_BUILDERS.has(name)) return;
			const handler = config.properties.find((property) => property.key.name === 'handler');
			const value = handler && unwrap(handler.value);
			if (value?.type !== 'ArrowFunctionExpression' && value?.type !== 'FunctionExpression') {
				context.report({ node: handler ?? call, messageId: 'inlineHandler', data: { name } });
			}
		}

		return {
			ImportDeclaration(node) {
				if (!isGeneratedServer(node.source.value)) return;
				for (const specifier of node.specifiers) {
					if (specifier.type === 'ImportNamespaceSpecifier') {
						context.report({ node: specifier, messageId: 'namespaceImport' });
						continue;
					}
					if (specifier.type !== 'ImportSpecifier') continue;
					const name = specifier.imported.name ?? specifier.imported.value;
					if (!BUILDERS.has(name)) continue;
					if (specifier.local.name !== name) {
						context.report({ node: specifier, messageId: 'aliasedImport', data: { name } });
						continue;
					}
					const [variable] = context.sourceCode.getDeclaredVariables(specifier);
					for (const reference of variable?.references ?? []) {
						const identifier = reference.identifier;
						if (reference.isTypeReference || identifier.parent.type === 'TSTypeQuery') continue;
						const parent = identifier.parent;
						if (parent.type === 'CallExpression' && parent.callee === identifier) {
							if (parent.optional) {
								context.report({ node: parent, messageId: 'optionalCall', data: { name } });
							} else {
								checkRegistration(parent, name);
							}
						} else if (!isCustomBuilderArgument(identifier, context.sourceCode)) {
							context.report({ node: identifier, messageId: 'indirectReference', data: { name } });
						}
					}
				}
			},
			ExportNamedDeclaration(node) {
				if (!node.source || !isGeneratedServer(node.source.value)) return;
				for (const specifier of node.specifiers) {
					const name = specifier.local.name ?? specifier.local.value;
					if (BUILDERS.has(name)) {
						context.report({ node: specifier, messageId: 'reexport', data: { name } });
					}
				}
			},
			ExportAllDeclaration(node) {
				if (isGeneratedServer(node.source.value)) {
					context.report({ node, messageId: 'reexport', data: { name: '*' } });
				}
			}
		};
	}
};
