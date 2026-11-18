/**
 * ESLint rule: no-source-text-read
 *
 * Flags a test that reads a production source file as text: `readFileSync` or
 * `readFile` from `node:fs` or `node:fs/promises`, `Bun.file`, a `?raw` import,
 * a raw `import.meta.glob`, or a same-file helper that passes one of its
 * parameters to one of those reads. A target counts when it has a code extension,
 * sits under one of the `roots` option's directories, and is not itself a test or
 * fixture. Files outside the roots, and non-code files such as `.css`, `.html` and
 * `.json`, are out of scope.
 *
 * Generated output is not authored source: a target whose basename contains
 * `.generated.` or `.bundle.` passes, so a test may compare a committed generated
 * file with a fresh run of its generator.
 *
 * Why: a test imports what it tests. An assertion on source text passes while the
 * behaviour it names breaks, and fails on a harmless rewrite. The exception is a
 * two-sided contract that reads the real producer and the real consumer and
 * rejects a planted corruption. It lives in a `*.contract.test.ts` file, which
 * this rule skips.
 *
 * The rule computes a path from string literals, `const` bindings, template
 * literals, `+`, `path.resolve` / `join` / `dirname`, `import.meta.dirname`,
 * `__dirname`, `process.cwd()`, `new URL(relative,
 * import.meta.url)` and `fileURLToPath`. A relative path handed to a read resolves
 * against the repository root, where the test runner starts; an import specifier
 * resolves against the test file. Any other expression, such as a path under
 * `tmpdir()` or a loop variable, is left unchecked.
 *
 * ❌ const source = readFileSync('src/lib/convex/users.ts', 'utf8');
 *    expect(source).toContain('requireAdmin');
 * ✅ import { listUsers } from '$lib/convex/users';
 *    await expect(asMember.query(listUsers)).rejects.toThrow();
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FS_MODULES = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises']);
const PATH_MODULES = new Set(['path', 'node:path']);
const URL_MODULES = new Set(['url', 'node:url']);
const READERS = new Set(['readFileSync', 'readFile']);
const PATH_HELPERS = new Set(['resolve', 'join', 'dirname']);
const CODE_EXTENSIONS = new Set([
	'.ts',
	'.tsx',
	'.js',
	'.jsx',
	'.mjs',
	'.cjs',
	'.mts',
	'.cts',
	'.svelte'
]);
const TEST_NAME = /\.(test|spec)\./;
const GENERATED_NAME = /\.(generated|bundle)\./;
const TEST_DIRECTORIES = new Set(['__tests__', '__fixtures__', 'test-fixtures']);
const CONTRACT_FILE = /\.contract\.test\.[^./]+$/;
const TS_WRAPPERS = new Set([
	'TSAsExpression',
	'TSSatisfiesExpression',
	'TSNonNullExpression',
	'TSTypeAssertion',
	'TSInstantiationExpression'
]);

function unwrap(node) {
	let result = node;
	while (TS_WRAPPERS.has(result?.type)) result = result.expression;
	return result;
}
const FUNCTIONS = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration']);
// Stands in for a helper's parameter while the rule checks whether it reaches a read.
// It is plain ASCII so that it survives URL parsing and path normalisation.
const PARAMETER_MARKER = '__no_source_text_read_parameter__';

const nameOf = (node) =>
	node?.type === 'Identifier' ? node.name : node?.type === 'Literal' ? node.value : undefined;

const propertyName = (member) =>
	member?.type === 'MemberExpression' && !member.computed ? member.property.name : undefined;

function findVariable(scope, name) {
	for (let current = scope; current; current = current.upper) {
		const variable = current.set.get(name);
		if (variable) return variable;
	}
	return undefined;
}

const isImportMeta = (node) =>
	node?.type === 'MetaProperty' && node.meta.name === 'import' && node.property.name === 'meta';

/** The identifier that binds each parameter of `fn`, `undefined` for destructured ones. */
const parameterIdentifiers = (fn) =>
	fn.params.map((param) => {
		const target = param.type === 'AssignmentPattern' ? param.left : param;
		return target.type === 'Identifier' ? target : undefined;
	});

export default {
	meta: {
		type: 'suggestion',
		docs: {
			description: 'Disallow tests that read production source files as text'
		},
		schema: [
			{
				type: 'object',
				properties: {
					roots: { type: 'array', items: { type: 'string' }, uniqueItems: true }
				},
				required: ['roots'],
				additionalProperties: false
			}
		],
		messages: {
			sourceTextRead:
				'Import the module behind `{{target}}` and test its behaviour; a test that reads production source as text passes while behaviour breaks. A two-sided contract that reads both producer and consumer and rejects a planted corruption belongs in a `*.contract.test.ts` file.'
		}
	},
	create(context) {
		const filename = context.filename;
		if (CONTRACT_FILE.test(path.basename(filename))) return {};

		const cwd = context.cwd;
		const directory = path.dirname(filename);
		const roots = context.options[0].roots.map((root) => root.replace(/\/+$/, ''));
		const sourceCode = context.sourceCode;
		const wrapperReads = new Map();

		const variableOf = (identifier) =>
			findVariable(sourceCode.getScope(identifier), identifier.name);
		// Configured globals such as `URL` and `__dirname` are scope variables without a definition.
		const isGlobal = (identifier) => !variableOf(identifier)?.defs.length;

		/** `{ source, imported }` when `identifier` is bound by an import declaration. */
		function importOf(identifier) {
			if (identifier?.type !== 'Identifier') return undefined;
			const def = variableOf(identifier)?.defs[0];
			if (def?.type !== 'ImportBinding') return undefined;
			const imported = def.node.type === 'ImportSpecifier' ? nameOf(def.node.imported) : 'default';
			return { source: def.parent.source.value, imported };
		}

		/** True for `fs`, `fs.promises` and `promises` bound from a node:fs module. */
		function isFsObject(wrapped) {
			const node = unwrap(wrapped);
			if (node?.type === 'MemberExpression') {
				return propertyName(node) === 'promises' && isFsObject(node.object);
			}
			const binding = importOf(node);
			return (
				FS_MODULES.has(binding?.source) &&
				(binding.imported === 'default' || binding.imported === 'promises')
			);
		}

		/** True when `callee` names `name` from one of `modules`, as an import or a member of one. */
		function isModuleFunction(callee, modules, names) {
			if (callee.type === 'Identifier') {
				const binding = importOf(callee);
				return modules.has(binding?.source) && names.has(binding.imported);
			}
			if (!names.has(propertyName(callee))) return false;
			const binding = importOf(unwrap(callee.object));
			return modules.has(binding?.source) && binding.imported === 'default';
		}

		function isReader(callee) {
			if (callee.type === 'Identifier') {
				const binding = importOf(callee);
				return FS_MODULES.has(binding?.source) && READERS.has(binding.imported);
			}
			if (callee.type !== 'MemberExpression') return false;
			const property = propertyName(callee);
			const object = unwrap(callee.object);
			if (property === 'file' && object.type === 'Identifier') {
				return object.name === 'Bun' && isGlobal(object);
			}
			return READERS.has(property) && isFsObject(callee.object);
		}

		/** Absolute path of a file URL, or the path unchanged when it already is one. */
		function toPath(value) {
			if (!value?.startsWith('file:')) return value;
			try {
				return fileURLToPath(value);
			} catch {
				return undefined;
			}
		}

		function evaluateUrl(node, env, seen) {
			const [relative, base] = node.arguments;
			const href = evaluate(relative, env, seen);
			if (href === undefined) return undefined;
			if (!base) return href.startsWith('file:') ? toPath(href) : undefined;
			const baseValue = evaluate(base, env, seen);
			if (baseValue === undefined) return undefined;
			try {
				const baseHref = baseValue.startsWith('file:') ? baseValue : pathToFileURL(baseValue).href;
				const url = new URL(href, baseHref);
				return url.protocol === 'file:' ? fileURLToPath(url) : undefined;
			} catch {
				return undefined;
			}
		}

		function evaluateCall(node, env, seen) {
			const callee = unwrap(node.callee);
			if (
				callee.type === 'MemberExpression' &&
				nameOf(callee.object) === 'process' &&
				isGlobal(callee.object) &&
				propertyName(callee) === 'cwd'
			) {
				return cwd;
			}
			const values = node.arguments.map((argument) => evaluate(argument, env, seen));
			if (values.some((value) => value === undefined)) return undefined;
			if (isModuleFunction(callee, URL_MODULES, new Set(['fileURLToPath']))) {
				return toPath(values[0]);
			}
			if (!isModuleFunction(callee, PATH_MODULES, PATH_HELPERS)) return undefined;
			const helper =
				callee.type === 'Identifier' ? importOf(callee).imported : propertyName(callee);
			if (helper === 'resolve') return path.resolve(cwd, ...values);
			if (helper === 'join') return values.length ? path.join(...values) : undefined;
			return values.length === 1 ? path.dirname(values[0]) : undefined;
		}

		function evaluateIdentifier(node, env, seen) {
			if (isGlobal(node)) {
				if (node.name === '__dirname') return directory;
				if (node.name === '__filename') return filename;
				return undefined;
			}
			const def = variableOf(node).defs[0];
			if (def?.type === 'Parameter') return env.get(variableOf(node));
			if (def?.type !== 'Variable' || def.parent.kind !== 'const' || !def.node.init) {
				return undefined;
			}
			if (def.node.id.type !== 'Identifier' || seen.has(def.node)) return undefined;
			return evaluate(def.node.init, env, new Set(seen).add(def.node));
		}

		/** The string or path `node` computes to, or `undefined` when the rule cannot tell. */
		function evaluate(node, env, seen = new Set()) {
			node = unwrap(node);
			switch (node?.type) {
				case 'Literal':
					return typeof node.value === 'string' ? node.value : undefined;
				case 'TemplateLiteral': {
					let text = node.quasis[0].value.cooked;
					for (const [index, expression] of node.expressions.entries()) {
						const value = evaluate(expression, env, seen);
						if (value === undefined) return undefined;
						text += value + node.quasis[index + 1].value.cooked;
					}
					return text;
				}
				case 'BinaryExpression': {
					if (node.operator !== '+') return undefined;
					const left = evaluate(node.left, env, seen);
					const right = evaluate(node.right, env, seen);
					return left === undefined || right === undefined ? undefined : left + right;
				}
				case 'Identifier':
					return evaluateIdentifier(node, env, seen);
				case 'MemberExpression': {
					const property = propertyName(node);
					if (isImportMeta(node.object)) {
						if (property === 'dirname') return directory;
						if (property === 'filename') return filename;
						if (property === 'url') return pathToFileURL(filename).href;
						return undefined;
					}
					return undefined;
				}
				case 'CallExpression':
					return evaluateCall(node, env, seen);
				case 'NewExpression':
					return nameOf(node.callee) === 'URL' && isGlobal(node.callee)
						? evaluateUrl(node, env, seen)
						: undefined;
				default:
					return undefined;
			}
		}

		/** The function a call's identifier callee is declared as in this file. */
		function localFunction(callee) {
			if (callee.type !== 'Identifier') return undefined;
			const def = variableOf(callee)?.defs[0];
			if (def?.type === 'FunctionName') return def.node;
			if (def?.type === 'Variable' && def.parent.kind === 'const') {
				const init = unwrap(def.node.init);
				return FUNCTIONS.has(init?.type) ? init : undefined;
			}
			return undefined;
		}

		/** Calls inside `fn` that read a path built from one of its parameters. */
		function readsThroughParameters(fn) {
			if (wrapperReads.has(fn)) return wrapperReads.get(fn);
			wrapperReads.set(fn, []);
			const markers = new Map();
			for (const [index, identifier] of parameterIdentifiers(fn).entries()) {
				if (identifier) {
					markers.set(variableOf(identifier), `${PARAMETER_MARKER}${index}${PARAMETER_MARKER}`);
				}
			}
			const reads = [];
			const visit = (node) => {
				if (node.type === 'CallExpression') {
					const values = readTargets(node, markers);
					if (values.some((value) => value?.includes(PARAMETER_MARKER))) reads.push(node);
				}
				for (const key of sourceCode.visitorKeys[node.type] ?? []) {
					for (const child of [node[key]].flat()) {
						if (child && typeof child.type === 'string') visit(child);
					}
				}
			};
			if (markers.size) visit(fn.body);
			wrapperReads.set(fn, reads);
			return reads;
		}

		/** Every path a call reads, `undefined` where a path cannot be computed. */
		function readTargets(call, env) {
			const callee = unwrap(call.callee);
			if (isReader(callee)) return [evaluate(call.arguments[0], env)];
			const fn = localFunction(callee);
			if (!fn) return [];
			const reads = readsThroughParameters(fn);
			if (!reads.length) return [];
			const argumentsEnv = new Map();
			for (const [index, identifier] of parameterIdentifiers(fn).entries()) {
				const argument = call.arguments[index];
				if (identifier && argument)
					argumentsEnv.set(variableOf(identifier), evaluate(argument, env));
			}
			return reads.flatMap((read) => readTargets(read, argumentsEnv));
		}

		/** A Vite import specifier as a path: relative to this file, or rooted at the repository. */
		function specifierPath(specifier) {
			if (specifier.startsWith('./') || specifier.startsWith('../')) {
				return path.resolve(directory, specifier);
			}
			return specifier.startsWith('/') ? path.join(cwd, specifier) : undefined;
		}

		/** The repository-relative path when `value` is authored source under a root. */
		function authoredSource(value) {
			const relative = path.relative(cwd, path.resolve(cwd, value)).split(path.sep).join('/');
			if (!roots.some((root) => relative === root || relative.startsWith(`${root}/`))) {
				return undefined;
			}
			const segments = relative.split('/');
			const basename = segments.at(-1);
			if (
				!CODE_EXTENSIONS.has(path.extname(basename)) ||
				TEST_NAME.test(basename) ||
				GENERATED_NAME.test(basename) ||
				segments.some((part) => TEST_DIRECTORIES.has(part))
			) {
				return undefined;
			}
			return relative;
		}

		function check(node, value) {
			if (value === undefined || value.includes(PARAMETER_MARKER)) return;
			const target = authoredSource(value);
			if (target) context.report({ node, messageId: 'sourceTextRead', data: { target } });
		}

		function checkRawSpecifier(node, specifier) {
			if (typeof specifier !== 'string' || !specifier.endsWith('?raw')) return;
			check(node, specifierPath(specifier.slice(0, -'?raw'.length)));
		}

		function isRawGlob(options) {
			if (options?.type !== 'ObjectExpression') return false;
			return options.properties.some((property) => {
				const key = property.type === 'Property' ? nameOf(property.key) : undefined;
				const value = property.value?.type === 'Literal' ? property.value.value : undefined;
				return (key === 'query' && value === '?raw') || (key === 'as' && value === 'raw');
			});
		}

		function checkGlob(node) {
			const [patterns, options] = node.arguments;
			if (!isRawGlob(options)) return;
			const list = patterns?.type === 'ArrayExpression' ? patterns.elements : [patterns];
			for (const pattern of list) {
				const value = evaluate(pattern, new Map());
				if (value === undefined || value.startsWith('!')) continue;
				check(node, specifierPath(value));
			}
		}

		return {
			ImportDeclaration(node) {
				checkRawSpecifier(node, node.source.value);
			},
			ImportExpression(node) {
				checkRawSpecifier(node, evaluate(node.source, new Map()));
			},
			CallExpression(node) {
				if (isImportMeta(node.callee.object) && propertyName(node.callee) === 'glob') {
					checkGlob(node);
					return;
				}
				for (const value of readTargets(node, new Map())) check(node, value);
			}
		};
	}
};
