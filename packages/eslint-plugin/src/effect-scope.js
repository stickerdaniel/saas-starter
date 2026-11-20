import path from 'node:path';

export const scopeSchema = [
	{
		type: 'object',
		properties: {
			files: { type: 'array', items: { type: 'string' } },
			allow: { type: 'array', items: { type: 'string' } }
		},
		additionalProperties: false
	}
];

export function relativeFilename(context) {
	return path.relative(context.cwd, context.filename).split(path.sep).join('/');
}

export const matchesAny = (file, globs) => globs.some((glob) => path.matchesGlob(file, glob));

export function inScope(context) {
	const { files = [], allow = [] } = context.options[0] ?? {};
	const file = relativeFilename(context);
	return matchesAny(file, files) && !matchesAny(file, allow);
}

function findVariable(scope, name) {
	for (let current = scope; current; current = current.upper) {
		const variable = current.set.get(name);
		if (variable) return variable;
	}
	return undefined;
}

export const isGlobal = (context, node) => {
	const variable = findVariable(context.sourceCode.getScope(node), node.name);
	return !variable || variable.defs.length === 0;
};

export const propertyName = (node) => {
	if (node.type !== 'MemberExpression') return undefined;
	if (!node.computed && node.property.type === 'Identifier') return node.property.name;
	if (
		node.computed &&
		node.property.type === 'Literal' &&
		typeof node.property.value === 'string'
	) {
		return node.property.value;
	}
	if (
		node.computed &&
		node.property.type === 'TemplateLiteral' &&
		node.property.expressions.length === 0
	) {
		return node.property.quasis[0].value.cooked;
	}
	return undefined;
};

export function effectModule(source) {
	if (source === 'effect') return '';
	return source.startsWith('effect/') ? source.slice('effect/'.length) : undefined;
}

function importedName(specifier) {
	const imported = specifier.imported;
	return imported.type === 'Identifier' ? imported.name : imported.value;
}

function bindingOf(definition) {
	if (definition.type !== 'ImportBinding' || definition.parent.type !== 'ImportDeclaration') {
		return undefined;
	}
	const module = effectModule(definition.parent.source.value);
	if (module === undefined) return undefined;
	const specifier = definition.node;
	if (specifier.type === 'ImportNamespaceSpecifier') return { namespace: module };
	if (specifier.type !== 'ImportSpecifier') return undefined;
	const name = importedName(specifier);
	return module === '' ? { namespace: name } : { namespace: module, member: name };
}

export function resolveEffect(context, node, seen = new Set()) {
	if (node.type === 'Identifier') {
		const variable = findVariable(context.sourceCode.getScope(node), node.name);
		const definition = variable?.defs[0];
		if (!definition || seen.has(definition.node)) return undefined;
		seen.add(definition.node);
		if (definition.type === 'ImportBinding') return bindingOf(definition);
		const declarator = definition.node;
		if (
			definition.type === 'Variable' &&
			declarator.id.type === 'Identifier' &&
			declarator.init &&
			declarator.parent.kind === 'const'
		) {
			return resolveEffect(context, declarator.init, seen);
		}
		return undefined;
	}
	if (node.type === 'MemberExpression') {
		const object = resolveEffect(context, node.object, seen);
		const member = propertyName(node);
		if (!object || object.member || !member) return undefined;
		return object.namespace === ''
			? { namespace: member }
			: { namespace: object.namespace, member };
	}
	return undefined;
}

export const isEffectMember = (binding, namespace, members) =>
	binding?.namespace === namespace &&
	binding.member !== undefined &&
	(typeof members === 'function' ? members(binding.member) : members.includes(binding.member));
