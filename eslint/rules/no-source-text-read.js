/**
 * ESLint rule: no-source-text-read
 *
 * Flags a test that reads a production source file as text: `readFileSync` or
 * `readFile` from `node:fs` or `node:fs/promises`, `Bun.file`, either reader
 * through a `const` alias or destructuring, a `?raw` import, a raw
 * `import.meta.glob`, or a same-file helper that passes one of its parameters to
 * one of those reads. A target counts when it has a code extension,
 * sits under one of the `roots` option's directories, and is not itself a test or
 * fixture. Files outside the roots, and non-code files such as `.css`, `.html` and
 * `.json`, are out of scope.
 *
 * A shared helper can hand the same text to a test. The `helpers` option lists such
 * helpers by module and export name, and taking one from its module counts as a
 * read: a named import, a namespace member or destructuring, or the same through
 * `import()`. A use of the module the rule cannot follow counts as well.
 *
 * Generated output is not authored source: a target whose basename contains
 * `.generated.` or `.bundle.` passes, so a test may compare a committed generated
 * file with a fresh run of its generator.
 *
 * Why: a test imports what it tests. An assertion on source text passes while the
 * behaviour it names breaks, and fails on a harmless rewrite. The exception is a
 * two-sided contract that reads the real producer and the real consumer and
 * rejects a planted corruption. The `contracts` option lists each such file by its
 * repository path, and the rule skips exactly the listed files. A human approves
 * each entry.
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
const FS_OBJECT_PATHS = new Set(['', 'promises', 'default', 'default.promises']);
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
const WHY_AND_EXEMPTION =
	"a test that reads production source as text passes while behaviour breaks. The one exemption is a two-sided contract that reads both producer and consumer, rejects a planted corruption, and is listed in this rule's `contracts` option in `eslint.config.js`; a human approves each new entry.";
const TS_WRAPPERS = new Set([
	'TSAsExpression',
	'TSSatisfiesExpression',
	'TSNonNullExpression',
	'TSTypeAssertion',
	'TSInstantiationExpression'
]);

// The package.json `imports` and SvelteKit aliases a test reaches a helper through.
const ALIASES = { '#lib/': 'src/lib/', '#blocks/': 'src/blocks/', '$lib/': 'src/lib/' };
const withoutExtension = (file) => file.replace(/\.(c|m)?[jt]sx?$/, '');

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
					roots: { type: 'array', items: { type: 'string' }, uniqueItems: true },
					contracts: { type: 'array', items: { type: 'string' }, uniqueItems: true },
					helpers: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								module: { type: 'string' },
								names: { type: 'array', items: { type: 'string' }, minItems: 1 }
							},
							required: ['module', 'names'],
							additionalProperties: false
						}
					}
				},
				required: ['roots'],
				additionalProperties: false
			}
		],
		messages: {
			sourceTextRead: `Import the module behind \`{{target}}\` and test its behaviour; ${WHY_AND_EXEMPTION}`,
			sourceTextHelper: `\`{{name}}\` hands production source text to this test; ${WHY_AND_EXEMPTION}`
		}
	},
	create(context) {
		const filename = context.filename;
		const cwd = context.cwd;
		const relativeFilename = path.relative(cwd, filename).split(path.sep).join('/');
		if (context.options[0].contracts?.includes(relativeFilename)) return {};

		const directory = path.dirname(filename);
		const roots = context.options[0].roots.map((root) => root.replace(/\/+$/, ''));
		const sourceCode = context.sourceCode;
		const wrapperReads = new Map();
		const helpers = (context.options[0].helpers ?? []).map(({ module, names }) => ({
			module: withoutExtension(module),
			names: new Set(names)
		}));

		const variableOf = (identifier) =>
			findVariable(sourceCode.getScope(identifier), identifier.name);
		// Configured globals such as `URL` and `__dirname` are scope variables without a definition.
		const isGlobal = (identifier) => !variableOf(identifier)?.defs.length;

		/** The `import()` an awaited expression resolves, as in `await import('node:fs')`. */
		function awaitedImport(node) {
			const awaited = unwrap(node);
			return awaited?.type === 'AwaitExpression' && awaited.argument.type === 'ImportExpression'
				? awaited.argument
				: undefined;
		}

		/** The function `import(x).then(fn)` hands the module to. */
		function thenCallback(loader) {
			const member = loader.parent;
			const call = member?.parent;
			if (member?.type !== 'MemberExpression' || member.object !== loader) return undefined;
			if (propertyName(member) !== 'then' || call?.type !== 'CallExpression') return undefined;
			return call.callee === member && FUNCTIONS.has(call.arguments[0]?.type)
				? call.arguments[0]
				: undefined;
		}

		/** The `import()` whose module the first parameter of `fn` receives. */
		function thenImport(fn) {
			const callee = fn.parent?.type === 'CallExpression' ? fn.parent.callee : undefined;
			const loader = callee?.type === 'MemberExpression' ? callee.object : undefined;
			return loader?.type === 'ImportExpression' && thenCallback(loader) === fn
				? loader
				: undefined;
		}

		/**
		 * The property names from `pattern` down to `name`: `[]` when the pattern is the
		 * name, `['promises', 'readFile']` for `{ promises: { readFile: name } }`.
		 */
		function patternKeys(pattern, name) {
			if (pattern === name) return [];
			if (pattern?.type === 'AssignmentPattern') return patternKeys(pattern.left, name);
			if (pattern?.type !== 'ObjectPattern') return undefined;
			for (const entry of pattern.properties) {
				if (entry.type !== 'Property' || entry.computed) continue;
				const keys = patternKeys(entry.value, name);
				if (keys) return [nameOf(entry.key), ...keys];
			}
			return undefined;
		}

		/**
		 * `{ source, imported }` for a name bound from a dynamic import: `default` for the
		 * module, a dotted path such as `promises.readFile` for a nested destructuring.
		 */
		function dynamicImportOf(def) {
			const [loader, pattern] =
				def.type === 'Variable'
					? [awaitedImport(def.node.init), def.node.id]
					: def.type === 'Parameter' && FUNCTIONS.has(def.node.type)
						? [thenImport(def.node), def.node.params[0]]
						: [];
			const source = loader && evaluate(loader.source, new Map());
			if (source === undefined) return undefined;
			const keys = patternKeys(pattern, def.name);
			if (!keys) return undefined;
			return { source, imported: keys.length ? keys.join('.') : 'default' };
		}

		/** `{ source, imported }` when `identifier` is bound by an import declaration or `import()`. */
		function importOf(identifier) {
			if (identifier?.type !== 'Identifier') return undefined;
			const def = variableOf(identifier)?.defs[0];
			if (def && def.type !== 'ImportBinding') return dynamicImportOf(def);
			if (def?.type !== 'ImportBinding') return undefined;
			const imported = def.node.type === 'ImportSpecifier' ? nameOf(def.node.imported) : 'default';
			return { source: def.parent.source.value, imported };
		}

		/**
		 * What a `const` binding of `identifier` holds: `{ value, keys: [] }` for
		 * `const x = value`, `{ value, keys: ['a', 'b'] }` for `const { a: { b: x } } = value`.
		 */
		function constAlias(identifier) {
			if (identifier?.type !== 'Identifier') return undefined;
			const def = variableOf(identifier)?.defs[0];
			if (def?.type !== 'Variable' || def.parent.kind !== 'const' || !def.node.init) {
				return undefined;
			}
			const keys = patternKeys(def.node.id, def.name);
			return keys ? { value: unwrap(def.node.init), keys } : undefined;
		}

		/** True for a node:fs module, its `promises`, or either taken through `default`. */
		const isFsPath = (keys) => FS_OBJECT_PATHS.has(keys.join('.'));

		/** True for `fs`, `fs.promises` and `promises` bound from a node:fs module. */
		function isFsObject(wrapped, seen = new Set()) {
			const node = unwrap(wrapped);
			if (node?.type === 'MemberExpression') {
				return propertyName(node) === 'promises' && isFsObject(node.object, seen);
			}
			const loader = awaitedImport(node);
			if (loader) return FS_MODULES.has(evaluate(loader.source, new Map()));
			const binding = importOf(node);
			if (binding) {
				return FS_MODULES.has(binding.source) && isFsPath(binding.imported.split('.'));
			}
			const alias = constAlias(node);
			if (!alias || seen.has(alias.value) || !isFsPath(alias.keys)) return false;
			return isFsObject(alias.value, new Set(seen).add(alias.value));
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

		/** True when `object`, then `keys`, reaches `Bun.file` or a reader of a node:fs module. */
		function isMemberReader(keys, object, seen) {
			const property = keys.at(-1);
			const prefix = keys.slice(0, -1);
			if (property === 'file' && object.type === 'Identifier' && object.name === 'Bun') {
				return prefix.length === 0 && isGlobal(object);
			}
			return READERS.has(property) && isFsPath(prefix) && isFsObject(object, seen);
		}

		/** True when `callee` is a file reader, also through `const` aliases and destructuring. */
		function isReader(callee, seen = new Set()) {
			if (callee.type === 'Identifier') {
				const binding = importOf(callee);
				if (binding) {
					const keys = binding.imported.split('.');
					return (
						FS_MODULES.has(binding.source) &&
						READERS.has(keys.at(-1)) &&
						isFsPath(keys.slice(0, -1))
					);
				}
				const alias = constAlias(callee);
				if (!alias || seen.has(alias.value)) return false;
				const next = new Set(seen).add(alias.value);
				return alias.keys.length === 0
					? isReader(alias.value, next)
					: isMemberReader(alias.keys, alias.value, next);
			}
			if (callee.type !== 'MemberExpression') return false;
			return isMemberReader([propertyName(callee)], unwrap(callee.object), seen);
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

		/** A Vite import specifier as a path: relative to this file, an alias, or rooted at the repository. */
		function specifierPath(specifier) {
			if (specifier.startsWith('./') || specifier.startsWith('../')) {
				return path.resolve(directory, specifier);
			}
			const alias = Object.keys(ALIASES).find((prefix) => specifier.startsWith(prefix));
			if (alias) return path.join(cwd, ALIASES[alias], specifier.slice(alias.length));
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

		/** The `helpers` entry an import specifier names, by its repository path. */
		function helperOf(specifier) {
			const absolute = specifierPath(specifier);
			if (absolute === undefined) return undefined;
			const relative = withoutExtension(path.relative(cwd, absolute).split(path.sep).join('/'));
			return helpers.find((helper) => helper.module === relative);
		}

		/** Reports `name` taken from a helper; an unknown name stands for all its listed exports. */
		function reportHelper(node, helper, name) {
			if (name !== undefined && !helper.names.has(name)) return;
			const reported = name ?? [...helper.names].join('` or `');
			context.report({ node, messageId: 'sourceTextHelper', data: { name: reported } });
		}

		/** Reports the listed exports a destructuring takes; a rest element takes them all. */
		function checkPattern(pattern, helper) {
			for (const entry of pattern.properties) {
				const key = entry.type === 'Property' ? entry.key : undefined;
				const name = entry.computed ? evaluate(key, new Map()) : nameOf(key);
				reportHelper(entry, helper, name);
			}
		}

		/** Follows a helper module held as one value to what the test takes from it. */
		function checkModuleValue(node, helper) {
			const parent = node.parent;
			if (parent?.type === 'MemberExpression' && parent.object === node) {
				const name = parent.computed ? evaluate(parent.property, new Map()) : propertyName(parent);
				reportHelper(parent, helper, name);
				return;
			}
			const declared = parent?.type === 'VariableDeclarator' && parent.init === node;
			const pattern = declared
				? parent.id
				: parent?.type === 'AssignmentExpression' && parent.right === node
					? parent.left
					: undefined;
			if (pattern?.type === 'ObjectPattern') checkPattern(pattern, helper);
			else if (declared && pattern.type === 'Identifier') {
				for (const variable of sourceCode.getDeclaredVariables(parent)) {
					checkModuleVariable(variable, helper);
				}
			} else reportHelper(node, helper);
		}

		function checkModuleVariable(variable, helper) {
			for (const reference of variable.references) {
				if (reference.init || !reference.isRead() || reference.isValueReference === false) continue;
				if (reference.identifier.parent?.type === 'TSTypeQuery') continue;
				checkModuleValue(reference.identifier, helper);
			}
		}

		function checkHelperImport(node) {
			const helper = typeof node.source.value === 'string' && helperOf(node.source.value);
			if (!helper) return;
			for (const specifier of node.specifiers) {
				if (specifier.type === 'ImportSpecifier') {
					reportHelper(specifier, helper, nameOf(specifier.imported));
					continue;
				}
				for (const variable of sourceCode.getDeclaredVariables(specifier)) {
					checkModuleVariable(variable, helper);
				}
			}
		}

		function checkHelperImportExpression(node) {
			const specifier = evaluate(node.source, new Map());
			const helper = typeof specifier === 'string' && helperOf(specifier);
			if (!helper) return;
			if (node.parent?.type === 'AwaitExpression') {
				checkModuleValue(node.parent, helper);
				return;
			}
			const callback = thenCallback(node);
			if (!callback) {
				reportHelper(node, helper);
				return;
			}
			const [parameter] = callback.params;
			if (parameter?.type === 'ObjectPattern') checkPattern(parameter, helper);
			else if (parameter?.type === 'Identifier') {
				for (const variable of sourceCode.getDeclaredVariables(callback)) {
					if (variable.defs[0]?.name === parameter) checkModuleVariable(variable, helper);
				}
			} else if (parameter) reportHelper(parameter, helper);
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
				checkHelperImport(node);
			},
			ImportExpression(node) {
				checkRawSpecifier(node, evaluate(node.source, new Map()));
				checkHelperImportExpression(node);
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
