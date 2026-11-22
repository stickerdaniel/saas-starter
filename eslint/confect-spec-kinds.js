import fs from 'node:fs';
import path from 'node:path';
import { parser } from 'typescript-eslint';

const SKIPPED_KEYS = new Set(['parent', 'tokens', 'comments']);

export function findDefinition(context, identifier) {
	for (let scope = context.sourceCode.getScope(identifier); scope; scope = scope.upper) {
		const variable = scope.set.get(identifier.name);
		if (variable) return variable.defs[0];
	}
	return undefined;
}

function children(node) {
	return Object.entries(node).flatMap(([key, value]) =>
		SKIPPED_KEYS.has(key)
			? []
			: (Array.isArray(value) ? value : [value]).filter(
					(child) => child && typeof child.type === 'string'
				)
	);
}

export function walk(node, visit) {
	visit(node);
	for (const child of children(node)) walk(child, visit);
}

const specKinds = new Map();
const SPEC_PACKAGE = /^(@confect\/core|effect(\/[A-Za-z]+)?)$/;

const isTypeOnlyImport = (statement) =>
	statement.importKind === 'type' ||
	(statement.specifiers.length > 0 &&
		statement.specifiers.every(
			(specifier) => specifier.type === 'ImportSpecifier' && specifier.importKind === 'type'
		));

function readsOtherModules(program) {
	return program.body.some(
		(statement) =>
			(statement.type === 'ImportDeclaration' &&
				!isTypeOnlyImport(statement) &&
				!SPEC_PACKAGE.test(statement.source.value)) ||
			((statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportAllDeclaration') &&
				statement.source !== null &&
				statement.source !== undefined)
	);
}

function kindsOf(file) {
	let stat;
	try {
		stat = fs.statSync(file);
	} catch {
		return null;
	}
	const cached = specKinds.get(file);
	if (cached?.mtimeMs === stat.mtimeMs) return cached.spec;
	const kinds = new Map();
	const record = (name, kind) =>
		kinds.set(name, kinds.has(name) && kinds.get(name) !== kind ? undefined : kind);
	let program;
	try {
		program = parser.parseForESLint(fs.readFileSync(file, 'utf8'), {}).ast;
	} catch {
		return null;
	}
	const curried = new Set();
	let classified = true;
	walk(program, (node) => {
		if (node.type !== 'CallExpression' || curried.has(node)) return;
		const callee = node.callee.type === 'CallExpression' ? node.callee.callee : node.callee;
		if (
			callee.type !== 'MemberExpression' ||
			callee.computed ||
			callee.object.type !== 'Identifier' ||
			callee.object.name !== 'FunctionSpec'
		) {
			return;
		}
		const kind = callee.property.name;
		if (node.callee.type === 'CallExpression') {
			curried.add(node.callee);
			const [name] = node.arguments;
			if (name?.type === 'Literal' && typeof name.value === 'string') record(name.value, kind);
			else classified = false;
			return;
		}
		const [config] = node.arguments;
		const property =
			config?.type === 'ObjectExpression' &&
			config.properties.find(
				(entry) =>
					entry.type === 'Property' &&
					!entry.computed &&
					entry.key.type === 'Identifier' &&
					entry.key.name === 'name'
			);
		if (property && property.value.type === 'Literal' && typeof property.value.value === 'string') {
			record(property.value.value, kind);
		} else {
			classified = false;
		}
	});
	const spec = { kinds, isolated: classified && !readsOtherModules(program) };
	specKinds.set(file, { mtimeMs: stat.mtimeMs, spec });
	return spec;
}

function specFile(context, group) {
	if (group?.type !== 'Identifier') return null;
	const definition = findDefinition(context, group);
	if (definition?.type !== 'ImportBinding') return null;
	const source = definition.parent.source.value;
	if (!source.startsWith('.')) return null;
	const resolved = path.resolve(path.dirname(context.filename), source);
	return /\.[jt]s$/.test(resolved) ? resolved : `${resolved}.ts`;
}

function specOf(context, group) {
	const file = specFile(context, group);
	return file ? kindsOf(file) : null;
}

export function specKind(context, group, name) {
	return name?.type === 'Literal' ? specOf(context, group)?.kinds.get(name.value) : undefined;
}

export function isPlainOnlySpec(context, group, name, plainKinds) {
	const spec = specOf(context, group);
	return (
		spec !== null &&
		spec.isolated &&
		name?.type === 'Literal' &&
		plainKinds.has(spec.kinds.get(name.value)) &&
		[...spec.kinds.values()].every((kind) => plainKinds.has(kind))
	);
}
