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
import { resolveEffect } from 'eslint-plugin-saas-starter/effect-scope';
import path from 'node:path';
import { findDefinition, isPlainOnlySpec, plainFunctionId } from '../confect-spec-kinds.js';

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

const isFunction = (node) =>
	node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression';

const isStaticReference = (node) =>
	node.type === 'Identifier' ||
	(node.type === 'MemberExpression' && !node.computed && isStaticReference(node.object));

const EAGER_MEMBER = /^run|Unsafe$|Eager$/;

function evaluatesBinding(node) {
	switch (node?.type) {
		case 'AssignmentPattern':
			return true;
		case 'ObjectPattern':
			return node.properties.some((property) =>
				property.type === 'RestElement'
					? evaluatesBinding(property.argument)
					: property.computed || evaluatesBinding(property.value)
			);
		case 'ArrayPattern':
			return node.elements.some(evaluatesBinding);
		case 'RestElement':
			return evaluatesBinding(node.argument);
		default:
			return false;
	}
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Require the canonical form for raw Convex function registrations and Confect specs'
		},
		schema: [
			{
				type: 'object',
				properties: {
					confectDirectory: { type: 'string' },
					libraryFunctions: {
						type: 'array',
						items: { type: 'string', pattern: '^[^:]+:[^:]+$' },
						uniqueItems: true
					}
				},
				additionalProperties: false
			}
		],
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
				"Call `FunctionImpl.make(schema, group, 'name', implementation)` with a string literal name. The spec graph checks pair an implementation with its spec by that name.",
			inlineImplementation:
				'Pass a native implementation to `FunctionImpl.make` inline, or the Convex registration of a plain spec by its import. The registration rules read the handler form only inline, and accept an import only when the group comes from a spec file that reads no value from another module and either holds only plain specs or lists the function as library-created.',
			eagerImplementation:
				'Return `Effect.gen(...)` or an `Effect.fn(...)(...)` call directly from this implementation, with every step, default value and computed key inside the Effect; `.pipe(...)` and `Effect.fn` may follow with `effect/Effect` operators only, given identifiers, namespace import members, literals and functions, and no `run*`, `*Unsafe` or `*Eager` member. Confect calls the implementation before it runs middleware, so a step outside the Effect runs for a caller the middleware refuses.'
		}
	},
	create(context) {
		const { confectDirectory = 'src/lib/confect', libraryFunctions = [] } =
			context.options[0] ?? {};
		const confectRoot = path.resolve(context.cwd, confectDirectory);
		const listed = new Set(libraryFunctions);
		const isListedLibraryFunction = (group, name) =>
			listed.has(plainFunctionId(context, group, name, PLAIN_SPECS, confectRoot));

		const effectMember = (node, member) => {
			const binding = resolveEffect(context, node);
			return binding?.namespace === 'Effect' && binding.member === member;
		};

		const isGenerator = (node) => node?.type === 'FunctionExpression' && node.generator;

		const isNamespaceMember = (node) =>
			node.type === 'MemberExpression' &&
			!node.computed &&
			node.object.type === 'Identifier' &&
			findDefinition(context, node.object)?.node.type === 'ImportNamespaceSpecifier';

		const isInertReference = (node) => node.type === 'Identifier' || isNamespaceMember(node);

		const isInertArgument = (node) =>
			isInertReference(node) ||
			isFunction(node) ||
			node.type === 'Literal' ||
			(node.type === 'TemplateLiteral' && node.expressions.length === 0);

		const isEffectOperatorReference = (node) => {
			if (!isStaticReference(node)) return false;
			const binding = resolveEffect(context, node);
			return (
				binding?.namespace === 'Effect' &&
				Boolean(binding.member) &&
				!EAGER_MEMBER.test(binding.member)
			);
		};

		const isEffectOperator = (node) =>
			isEffectOperatorReference(node) ||
			(node.type === 'CallExpression' &&
				isEffectOperatorReference(node.callee) &&
				node.arguments.every(isInertArgument));

		function isEffectFn(call) {
			if (call.type !== 'CallExpression') return false;
			const [body, ...pipeables] = call.arguments;
			if (effectMember(call.callee, 'fn')) {
				return isGenerator(body) && pipeables.every(isEffectOperator);
			}
			return (
				call.callee.type === 'CallExpression' &&
				effectMember(call.callee.callee, 'fn') &&
				call.callee.arguments.every(
					(argument) => argument.type === 'Literal' && typeof argument.value === 'string'
				) &&
				isGenerator(body) &&
				pipeables.every(isEffectOperator)
			);
		}

		function isLazyEffect(node) {
			const expression = unwrap(node);
			if (expression.type !== 'CallExpression') return false;
			if (effectMember(expression.callee, 'gen')) {
				return expression.arguments.length === 1 && isGenerator(expression.arguments[0]);
			}
			if (isEffectFn(expression.callee)) {
				return expression.arguments.every(isInertReference);
			}
			const { callee } = expression;
			return (
				callee.type === 'MemberExpression' &&
				!callee.computed &&
				callee.property.type === 'Identifier' &&
				callee.property.name === 'pipe' &&
				isLazyEffect(callee.object) &&
				expression.arguments.every(isEffectOperator)
			);
		}

		function checkImplementation(group, name, implementation) {
			const value = unwrap(implementation);
			if (value.type === 'Identifier') {
				if (
					findDefinition(context, value)?.type !== 'ImportBinding' ||
					!(
						isPlainOnlySpec(context, group, name, PLAIN_SPECS) ||
						isListedLibraryFunction(group, name)
					)
				) {
					context.report({ node: value, messageId: 'inlineImplementation' });
				}
				return;
			}
			if (!isFunction(value)) {
				context.report({ node: value, messageId: 'inlineImplementation' });
				return;
			}
			const statements = value.body.type === 'BlockStatement' ? value.body.body : null;
			const returned =
				statements === null
					? value.body
					: statements.length === 1 && statements[0].type === 'ReturnStatement'
						? statements[0].argument
						: null;
			if (
				value.async ||
				value.generator ||
				value.params.some(evaluatesBinding) ||
				!returned ||
				!isLazyEffect(returned)
			) {
				context.report({ node: value, messageId: 'eagerImplementation' });
			}
		}

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
					return;
				}
				checkImplementation(call.arguments[1], call.arguments[2], call.arguments[3]);
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
