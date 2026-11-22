/**
 * ESLint rule: convex-canonical-registration
 *
 * Keeps every Convex registration in the one form the registration rules read.
 * `@convex-dev/require-access-control` and `local/convex-access-first` find a
 * raw registration by the callee names `query`, `mutation`, `action` and an
 * identifier key `handler`; `local/require-returns-validator` and
 * `local/require-custom-registrar-args` find a custom one by the builder names in
 * CUSTOM_REGISTRARS. Any other spelling hides a function from them. The rule
 * requires:
 *
 * - the raw builders `query`, `mutation`, `action` and their `internal*` forms
 *   are imported from `_generated/server`, and the custom builders from
 *   `functions`, under their own names, with no namespace import and no
 *   re-export;
 * - a builder binding is only called, without `?.`; a raw builder may also be
 *   passed to a builder imported from convex-helpers (`customQuery(query, ...)`);
 * - a raw registration takes one object literal whose keys are plain
 *   identifiers, with no spread and no computed key;
 * - a public registration has an inline `handler` function.
 *
 * Example: export const f = query({ args: {}, returns: v.null(), handler: async (ctx) => { ... } });
 */

import {
	CONFECT_CONSTRUCTORS,
	CONFECT_NATIVE_SPECS,
	CONFECT_PLAIN_SPECS,
	CUSTOM_REGISTRARS,
	RAW_REGISTRARS
} from '../convex-registrars.js';

const PUBLIC_BUILDERS = new Set(['query', 'mutation', 'action']);
const NATIVE_SPECS = new Set(CONFECT_NATIVE_SPECS);
const PLAIN_SPECS = new Set(CONFECT_PLAIN_SPECS);
const CONSTRUCTOR_MEMBERS = {
	FunctionSpec: new Set([...CONFECT_NATIVE_SPECS, ...CONFECT_PLAIN_SPECS]),
	FunctionImpl: new Set(['make'])
};

/** The builders a module provides, keyed by the import source that names it. */
const BUILDER_MODULES = [
	{ module: '_generated/server', raw: true, names: new Set(RAW_REGISTRARS) },
	{ module: 'functions', raw: false, names: new Set(CUSTOM_REGISTRARS) }
];

function builderModule(source) {
	return BUILDER_MODULES.find(({ module }) =>
		new RegExp(`(^|/)${module}(\\.[jt]s)?$`).test(source)
	);
}

function isStringLiteral(node) {
	return node?.type === 'Literal' && typeof node.value === 'string';
}

function hasPlainKeys(config) {
	return (
		config?.type === 'ObjectExpression' &&
		config.properties.every(
			(property) =>
				property.type === 'Property' && !property.computed && property.key.type === 'Identifier'
		)
	);
}

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
			description:
				'Require the canonical form for raw Convex function registrations and Confect specs'
		},
		schema: [],
		messages: {
			aliasedImport:
				'Import `{{name}}` from {{module}} under its own name. The registration rules find registrations by the builder name, so an alias hides a function from them.',
			namespaceImport:
				'Import the Convex builders from {{module}} by name. The registration rules cannot see a registration through a namespace object.',
			reexport:
				'Import `{{name}}` from {{module}} where it registers a function. The registration rules cannot see a registration through a re-exported builder.',
			indirectReference:
				'Call `{{name}}` directly{{exception}}. The registration rules cannot see a registration through another binding.',
			optionalCall:
				'Call `{{name}}` without `?.`. The access rules do not read a registration inside an optional chain.',
			configShape:
				'Pass `{{name}}` one object literal with plain identifier keys and no spread. The access rules read `handler` only as a plain key of that object.',
			inlineHandler:
				'Write the `handler` of this public `{{name}}` inline as a function. The access rules read the access call inside the handler body.',
			confectMember:
				'Call `{{name}}` as a member of its Confect constructor, without `?.`. The spec graph checks cannot see a registration through another binding.',
			plainSpecShape:
				"Write `FunctionSpec.{{name}}<typeof f>()('f')` with the string equal to the type query. The goldens and the generated groups pair a plain spec with its Convex registration by that name.",
			nativeSpecShape:
				'Pass `FunctionSpec.{{name}}` one object literal with plain identifier keys and a string literal `name`. The spec graph checks read the function name from it.',
			implShape:
				"Call `FunctionImpl.make(schema, group, 'name', implementation)` with a string literal name. The spec graph checks pair an implementation with its spec by that name."
		}
	},
	create(context) {
		function checkRegistration(call, name) {
			const config = call.arguments.length === 1 ? unwrap(call.arguments[0]) : null;
			if (!hasPlainKeys(config)) {
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

		function checkConfectReference(identifier, constructor) {
			const member = identifier.parent;
			if (member.type !== 'MemberExpression' || member.object !== identifier) {
				context.report({
					node: identifier,
					messageId: 'indirectReference',
					data: { name: constructor, exception: '' }
				});
				return;
			}
			const allowed = CONSTRUCTOR_MEMBERS[constructor];
			const name = member.computed ? null : member.property.name;
			if (!allowed || (name !== null && !allowed.has(name))) return;
			const call = member.parent;
			if (
				name === null ||
				member.optional ||
				call.type !== 'CallExpression' ||
				call.callee !== member ||
				call.optional
			) {
				context.report({
					node: member,
					messageId: 'confectMember',
					data: { name: `${constructor}.${name ?? '[]'}` }
				});
				return;
			}
			if (constructor === 'FunctionImpl') {
				if (call.arguments.length !== 4 || !isStringLiteral(call.arguments[2])) {
					context.report({ node: call, messageId: 'implShape' });
				}
				return;
			}
			if (NATIVE_SPECS.has(name)) {
				const config = call.arguments.length === 1 ? unwrap(call.arguments[0]) : null;
				const nameProperty =
					hasPlainKeys(config) &&
					config.properties.find((property) => property.key.name === 'name');
				if (!nameProperty || !isStringLiteral(nameProperty.value)) {
					context.report({ node: call, messageId: 'nativeSpecShape', data: { name } });
				}
				return;
			}
			if (PLAIN_SPECS.has(name)) {
				const [type, ...extraTypes] = (call.typeArguments ?? call.typeParameters)?.params ?? [];
				const named = call.parent;
				const valid =
					call.arguments.length === 0 &&
					extraTypes.length === 0 &&
					type?.type === 'TSTypeQuery' &&
					type.exprName.type === 'Identifier' &&
					named.type === 'CallExpression' &&
					named.callee === call &&
					!named.optional &&
					named.arguments.length === 1 &&
					isStringLiteral(named.arguments[0]) &&
					named.arguments[0].value === type.exprName.name;
				if (!valid) context.report({ node: call, messageId: 'plainSpecShape', data: { name } });
			}
		}

		function checkConfectImport(node, names) {
			for (const specifier of node.specifiers) {
				if (specifier.type === 'ImportNamespaceSpecifier') {
					context.report({
						node: specifier,
						messageId: 'namespaceImport',
						data: { module: node.source.value }
					});
					continue;
				}
				if (specifier.type !== 'ImportSpecifier') continue;
				const name = specifier.imported.name ?? specifier.imported.value;
				if (!names.includes(name)) continue;
				if (specifier.local.name !== name) {
					context.report({
						node: specifier,
						messageId: 'aliasedImport',
						data: { name, module: node.source.value }
					});
					continue;
				}
				const [variable] = context.sourceCode.getDeclaredVariables(specifier);
				for (const reference of variable?.references ?? []) {
					const identifier = reference.identifier;
					if (reference.isTypeReference || identifier.parent.type === 'TSTypeQuery') continue;
					if (identifier.parent.type === 'TSQualifiedName') continue;
					checkConfectReference(identifier, name);
				}
			}
		}

		return {
			ImportDeclaration(node) {
				const confect = Object.hasOwn(CONFECT_CONSTRUCTORS, node.source.value)
					? CONFECT_CONSTRUCTORS[node.source.value]
					: undefined;
				if (confect) {
					checkConfectImport(node, confect);
					return;
				}
				const source = builderModule(node.source.value);
				if (!source) return;
				const { module, raw, names } = source;
				for (const specifier of node.specifiers) {
					if (specifier.type === 'ImportNamespaceSpecifier') {
						context.report({ node: specifier, messageId: 'namespaceImport', data: { module } });
						continue;
					}
					if (specifier.type !== 'ImportSpecifier') continue;
					const name = specifier.imported.name ?? specifier.imported.value;
					if (!names.has(name)) continue;
					if (specifier.local.name !== name) {
						context.report({
							node: specifier,
							messageId: 'aliasedImport',
							data: { name, module }
						});
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
							} else if (raw) {
								checkRegistration(parent, name);
							}
						} else if (!raw || !isCustomBuilderArgument(identifier, context.sourceCode)) {
							context.report({
								node: identifier,
								messageId: 'indirectReference',
								data: {
									name,
									exception: raw ? ', or pass it to a builder imported from convex-helpers' : ''
								}
							});
						}
					}
				}
			},
			ExportNamedDeclaration(node) {
				const source = node.source && builderModule(node.source.value);
				if (!source) return;
				for (const specifier of node.specifiers) {
					const name = specifier.local.name ?? specifier.local.value;
					if (source.names.has(name)) {
						context.report({
							node: specifier,
							messageId: 'reexport',
							data: { name, module: source.module }
						});
					}
				}
			},
			ExportAllDeclaration(node) {
				const source = builderModule(node.source.value);
				if (source) {
					context.report({
						node,
						messageId: 'reexport',
						data: { name: '*', module: source.module }
					});
				}
			}
		};
	}
};
