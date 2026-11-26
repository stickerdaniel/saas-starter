import path from 'node:path';

/**
 * ESLint rule: variants-through-cn
 *
 * Requires every tailwind-variants result to be a direct argument of the shared
 * `cn()` imported from `#lib/utils.js`.
 *
 * Why: vite.config.ts resolves `tailwind-variants` to its lite build, which joins
 * classes without merging them. Only `cn()` resolves conflicts, including the
 * caller classes a variants function would otherwise merge through `class:`.
 *
 * A variants function is a binding initialized by a `tv` from tailwind-variants
 * (named, renamed or namespace import), whatever its name, or an imported binding
 * whose imported name ends in `Variants`, also when read from a namespace import
 * of a `components/ui/` module (by alias or by a relative path that resolves
 * there), where every variants function in `src` lives.
 * The rule checks every reference of those bindings after the whole file is
 * analysed, so declaration order does not matter. A variants function may only be
 * called, re-exported or used in a type; aliasing it, passing it on, destructuring
 * it from a namespace or reading a namespace with a computed key is reported at
 * that point, so the check never has to follow the value further.
 *
 * ❌ class={buttonVariants({ variant: 'ghost', class: 'absolute' })}
 * ✅ class={cn(buttonVariants({ variant: 'ghost' }), 'absolute')}
 */

const TV_SOURCES = new Set(['tailwind-variants', 'tailwind-variants/lite']);
const CN_SOURCE = '#lib/utils.js';
const VARIANTS = /Variants$/;
const UI_MODULE = /(^|\/)components\/ui\//;
const NAME_NODES = new Set([
	'SvelteMemberExpressionName',
	'JSXMemberExpression',
	'TSQualifiedName',
	'TSTypeQuery'
]);

function propertyName(node, computed) {
	if (!computed) return node.type === 'Identifier' ? node.name : null;
	return node.type === 'Literal' && typeof node.value === 'string' ? node.value : null;
}

function findVariable(scope, name) {
	for (let current = scope; current; current = current.upper) {
		const variable = current.set.get(name);
		if (variable) return variable;
	}
	return null;
}

function isPassiveReference(reference) {
	const { identifier } = reference;
	const parent = identifier.parent;
	return (
		reference.init === true ||
		reference.isWriteOnly?.() === true ||
		reference.isTypeReference === true ||
		parent?.type === 'ExportSpecifier' ||
		parent?.type === 'SvelteScriptElement' ||
		parent?.type === 'TSTypeQuery'
	);
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Require every tailwind-variants result to pass through cn()'
		},
		schema: [],
		messages: {
			outsideCn:
				'Pass {{name}}(...) straight into cn() from #lib/utils.js, with caller classes as further cn() arguments. The app resolves tailwind-variants to its lite build, which does not merge classes, so only cn() resolves conflicts.',
			escapes:
				'Call {{name}} directly inside cn() from #lib/utils.js instead of aliasing, passing or destructuring it. The variants-through-cn check follows only direct calls.',
			dynamicAccess:
				'Read members of the {{name}} namespace with a static name. A computed key hides tailwind-variants functions from the variants-through-cn check.'
		}
	},
	create(context) {
		const { sourceCode } = context;
		const directory = path.dirname(path.resolve(context.cwd, context.filename));
		const modulePath = (source) =>
			source.startsWith('.') ? path.resolve(directory, source).replaceAll('\\', '/') : source;

		return {
			'Program:exit'() {
				const variables = sourceCode.scopeManager.scopes.flatMap((scope) => scope.variables);
				const factories = new Set();
				const factoryNamespaces = new Set();
				const variants = new Set();
				const namespaces = new Set();
				const sharedCn = new Set();

				for (const variable of variables) {
					const definition = variable.defs[0];
					if (definition?.type !== 'ImportBinding') continue;
					const declaration = definition.parent;
					if (declaration.importKind === 'type' || definition.node.importKind === 'type') continue;
					const source = String(declaration.source.value);
					if (definition.node.type === 'ImportNamespaceSpecifier') {
						if (TV_SOURCES.has(source)) factoryNamespaces.add(variable);
						else if (UI_MODULE.test(modulePath(source))) namespaces.add(variable);
						continue;
					}
					if (definition.node.type !== 'ImportSpecifier') continue;
					const imported = propertyName(
						definition.node.imported,
						definition.node.imported.type === 'Literal'
					);
					if (TV_SOURCES.has(source) && imported === 'tv') factories.add(variable);
					else if (source === CN_SOURCE && imported === 'cn') sharedCn.add(variable);
					else if (imported && VARIANTS.test(imported)) variants.add(variable);
				}

				const resolve = (identifier) =>
					findVariable(sourceCode.getScope(identifier), identifier.name);

				function isFactoryCall(node) {
					if (node?.type !== 'CallExpression') return false;
					const { callee } = node;
					if (callee.type === 'Identifier') return factories.has(resolve(callee));
					return (
						callee.type === 'MemberExpression' &&
						callee.object.type === 'Identifier' &&
						factoryNamespaces.has(resolve(callee.object)) &&
						propertyName(callee.property, callee.computed) === 'tv'
					);
				}

				for (const variable of variables) {
					const definition = variable.defs[0];
					if (definition?.type !== 'Variable' || !isFactoryCall(definition.node.init)) continue;
					if (definition.node.id.type === 'Identifier') variants.add(variable);
				}

				function report(node, messageId, name) {
					context.report({ node, messageId, data: { name } });
				}

				function checkCall(call, name) {
					const wrapper = call.parent;
					const wrapped =
						wrapper?.type === 'CallExpression' &&
						wrapper.arguments.includes(call) &&
						wrapper.callee.type === 'Identifier' &&
						sharedCn.has(resolve(wrapper.callee));
					if (!wrapped) report(call, 'outsideCn', name);
				}

				function checkFunctionUse(node, name) {
					const parent = node.parent;
					if (parent?.type === 'CallExpression' && parent.callee === node) checkCall(parent, name);
					else report(node, 'escapes', name);
				}

				for (const variable of factories) {
					for (const reference of variable.references) {
						if (isPassiveReference(reference)) continue;
						const parent = reference.identifier.parent;
						if (parent?.type === 'CallExpression' && parent.callee === reference.identifier) {
							if (parent.parent?.type === 'VariableDeclarator' && parent.parent.init === parent) {
								if (parent.parent.id.type !== 'Identifier')
									report(parent.parent.id, 'escapes', variable.name);
								continue;
							}
						}
						report(reference.identifier, 'escapes', variable.name);
					}
				}

				for (const variable of factoryNamespaces) {
					for (const reference of variable.references) {
						if (isPassiveReference(reference)) continue;
						const member = reference.identifier.parent;
						const declarator = member?.parent?.parent;
						const declared =
							member?.type === 'MemberExpression' &&
							propertyName(member.property, member.computed) === 'tv' &&
							member.parent.type === 'CallExpression' &&
							member.parent.callee === member &&
							declarator?.type === 'VariableDeclarator' &&
							declarator.init === member.parent;
						if (!declared) report(reference.identifier, 'escapes', variable.name);
						else if (declarator.id.type !== 'Identifier') report(declarator.id, 'escapes', 'tv');
					}
				}

				for (const variable of variants) {
					for (const reference of variable.references) {
						if (isPassiveReference(reference)) continue;
						checkFunctionUse(reference.identifier, variable.name);
					}
				}

				for (const variable of namespaces) {
					for (const reference of variable.references) {
						if (isPassiveReference(reference)) continue;
						const parent = reference.identifier.parent;
						if (parent?.type === 'MemberExpression' && parent.object === reference.identifier) {
							const name = propertyName(parent.property, parent.computed);
							if (name === null) report(parent, 'dynamicAccess', variable.name);
							else if (VARIANTS.test(name)) checkFunctionUse(parent, name);
							continue;
						}
						if (parent && NAME_NODES.has(parent.type)) continue;
						if (parent?.type === 'VariableDeclarator' && parent.init === reference.identifier) {
							const escaping =
								parent.id.type !== 'ObjectPattern' ||
								parent.id.properties.some(
									(property) =>
										property.type === 'RestElement' ||
										property.computed ||
										VARIANTS.test(propertyName(property.key, property.key.type === 'Literal') ?? '')
								);
							if (escaping) report(parent.id, 'escapes', variable.name);
							continue;
						}
						report(reference.identifier, 'escapes', variable.name);
					}
				}
			}
		};
	}
};
