import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LIB_ALIAS = '#lib/';
const INDEX_FILE = /^index(\.(js|ts))?$/;

function absoluteFilename(context) {
	const filename = String(context.filename ?? context.getFilename?.() ?? '');
	return path.isAbsolute(filename)
		? filename
		: path.resolve(String(context.cwd ?? context.getCwd?.() ?? process.cwd()), filename);
}

function resolvedTarget(specifier, directory) {
	if (specifier.startsWith(LIB_ALIAS)) {
		return path.join(REPOSITORY_ROOT, 'src/lib', specifier.slice(LIB_ALIAS.length));
	}
	if (specifier === '.' || specifier.startsWith('./') || specifier.startsWith('../')) {
		return path.resolve(directory, specifier);
	}
	return null;
}

function importsOwnBarrel(specifier, directory) {
	const target = resolvedTarget(specifier, directory);
	if (target === null) return false;
	if (target === directory) return true;
	return path.dirname(target) === directory && INDEX_FILE.test(path.basename(target));
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description: "Forbid a module from importing its own directory's index barrel"
		},
		schema: [],
		messages: {
			ownBarrel:
				"Import the sibling file directly (for example './dialog-overlay.svelte'): importing this directory's index can create an import cycle when the index re-exports this module."
		}
	},
	create(context) {
		const directory = path.dirname(absoluteFilename(context));

		function check(node) {
			const source = node.source;
			if (source?.type !== 'Literal' || typeof source.value !== 'string') return;
			if (node.importKind === 'type' || node.exportKind === 'type') return;
			if (importsOwnBarrel(source.value, directory)) {
				context.report({ node: source, messageId: 'ownBarrel' });
			}
		}

		return {
			ImportDeclaration: check,
			ExportNamedDeclaration: check,
			ExportAllDeclaration: check,
			ImportExpression: check
		};
	}
};
