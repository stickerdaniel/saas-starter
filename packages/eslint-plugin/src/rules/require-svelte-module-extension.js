import fs from 'node:fs';
import path from 'node:path';

/**
 * ESLint rule: require-svelte-module-extension
 *
 * Requires imports of `.svelte.ts` rune modules to use their explicit real
 * extension instead of the emitted `.svelte.js` form or shortened `.svelte`
 * form. Real component imports keep their `.svelte` extension.
 *
 * Why: the shortened form is ambiguous with component imports and is invalid
 * in Node ESM output. TypeScript rewrites explicit `.ts` extensions on emit.
 *
 * ❌ import { state } from './state.svelte.js';
 * ❌ import { state } from './state.svelte';
 * ✅ import { state } from './state.svelte.ts';
 * ✅ import Component from './Component.svelte';
 * ✅ import { state } from './state.svelte.js';   // when state.svelte.js is the real file
 *
 * Relative specifiers are always checked. The `aliases` option maps further
 * specifier prefixes to directories relative to the ESLint working directory,
 * such as a package.json "imports" entry:
 *
 * Config: 'local/require-svelte-module-extension': ['error', { aliases: { '#lib/': 'src/lib/' } }]
 */

/** The alias entry whose prefix starts the specifier, or undefined. */
function matchAlias(specifier, aliases) {
	return Object.entries(aliases).find(([prefix]) => specifier.startsWith(prefix));
}

function isSupportedSpecifier(specifier, aliases) {
	return (
		specifier.startsWith('./') ||
		specifier.startsWith('../') ||
		matchAlias(specifier, aliases) !== undefined
	);
}

function resolveSpecifier(specifier, filename, cwd, aliases) {
	const alias = matchAlias(specifier, aliases);
	if (alias) {
		const [prefix, directory] = alias;
		// Joined, not resolved: a prefix without a trailing slash leaves a leading `/` in the rest.
		return path.join(path.resolve(cwd, directory), specifier.slice(prefix.length));
	}

	return path.resolve(path.dirname(filename), specifier);
}

/**
 * Only rewrite when a `.svelte.ts` module is what actually sits on disk. A
 * project may legitimately hold a JavaScript `foo.svelte.js` rune module, and
 * rewriting that specifier would autofix a working import into a missing file.
 */
function targetsTypeScriptModule(basePath) {
	return fs.existsSync(`${basePath}.svelte.ts`) && !fs.existsSync(`${basePath}.svelte.js`);
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Require explicit .svelte.ts extensions for Svelte rune module imports'
		},
		fixable: 'code',
		schema: [
			{
				type: 'object',
				properties: {
					aliases: { type: 'object', additionalProperties: { type: 'string' } }
				},
				additionalProperties: false
			}
		],
		messages: {
			emittedExtension:
				'Use the explicit real .svelte.ts extension for this rune module instead of .svelte.js.',
			shortenedExtension:
				'Use the explicit real .svelte.ts extension; the shortened .svelte form is ambiguous with components and invalid for Node ESM output.'
		}
	},
	create(context) {
		const filename = context.filename ?? context.getFilename();
		const cwd = context.cwd ?? process.cwd();
		const sourceCode = context.sourceCode ?? context.getSourceCode();
		const aliases = context.options?.[0]?.aliases ?? {};

		function checkSource(node) {
			if (!node || typeof node.value !== 'string') return;

			const specifier = node.value;
			if (!isSupportedSpecifier(specifier, aliases)) return;

			let messageId;
			let replacement;

			if (specifier.endsWith('.svelte.js')) {
				const stem = specifier.slice(0, -'.svelte.js'.length);
				if (!targetsTypeScriptModule(resolveSpecifier(stem, filename, cwd, aliases))) return;
				messageId = 'emittedExtension';
				replacement = `${stem}.svelte.ts`;
			} else if (specifier.endsWith('.svelte')) {
				const resolved = resolveSpecifier(specifier, filename, cwd, aliases);
				// An existing component file with the same stem always wins.
				if (fs.existsSync(resolved) || !fs.existsSync(`${resolved}.ts`)) return;
				messageId = 'shortenedExtension';
				replacement = `${specifier}.ts`;
			} else {
				return;
			}

			context.report({
				node,
				messageId,
				fix(fixer) {
					const raw = sourceCode.getText(node);
					const quote = raw[0] === '"' ? '"' : "'";
					return fixer.replaceText(node, `${quote}${replacement}${quote}`);
				}
			});
		}

		return {
			ImportDeclaration: (node) => checkSource(node.source),
			ExportNamedDeclaration: (node) => checkSource(node.source),
			ExportAllDeclaration: (node) => checkSource(node.source),
			ImportExpression: (node) => checkSource(node.source)
		};
	}
};
