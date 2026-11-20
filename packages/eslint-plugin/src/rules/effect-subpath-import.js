import { inScope, scopeSchema } from '../effect-scope.js';

const typeOnly = (node, kind, specifiers) =>
	node[kind] === 'type' ||
	(specifiers.length > 0 && specifiers.every((specifier) => specifier[kind] === 'type'));

export default {
	meta: {
		type: 'problem',
		docs: { description: 'Import Effect from its module subpaths, never the effect barrel' },
		schema: scopeSchema,
		messages: {
			barrel:
				"Import from the module subpath, such as `import * as Effect from 'effect/Effect'`. The `effect` barrel pulls every module into a bundle (121 KB gzip against 30 KB with subpaths). Type-only imports from `effect` are fine."
		}
	},
	create(context) {
		if (!inScope(context)) return {};
		const isBarrel = (source) => source?.type === 'Literal' && source.value === 'effect';
		return {
			ImportDeclaration(node) {
				if (isBarrel(node.source) && !typeOnly(node, 'importKind', node.specifiers)) {
					context.report({ node, messageId: 'barrel' });
				}
			},
			ExportNamedDeclaration(node) {
				if (isBarrel(node.source) && !typeOnly(node, 'exportKind', node.specifiers)) {
					context.report({ node, messageId: 'barrel' });
				}
			},
			ExportAllDeclaration(node) {
				if (isBarrel(node.source) && node.exportKind !== 'type') {
					context.report({ node, messageId: 'barrel' });
				}
			},
			ImportExpression(node) {
				if (isBarrel(node.source)) context.report({ node, messageId: 'barrel' });
			}
		};
	}
};
