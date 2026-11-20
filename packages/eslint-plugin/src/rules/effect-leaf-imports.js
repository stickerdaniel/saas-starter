import path from 'node:path';
import { inScope, matchesAny, relativeFilename, scopeSchema } from '../effect-scope.js';

const candidates = (file) => [file, `${file}.ts`, file.replace(/\.js$/, '.ts')];

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Keep the Effect leaf modules importing only effect/* subpaths, convex/values and each other'
		},
		schema: scopeSchema,
		messages: {
			leafImport:
				"The Effect leaf modules ship as a closed set: the Daphne gateway image copies exactly these files. Import only `effect/<Module>` subpaths, 'convex/values', or another leaf module by relative path. `{{source}}` leaves that set."
		}
	},
	create(context) {
		if (!inScope(context)) return {};
		const leaves = context.options[0]?.files ?? [];
		const directory = path.posix.dirname(relativeFilename(context));
		const allowed = (source) => {
			if (source.startsWith('effect/') || source === 'convex/values') return true;
			if (!source.startsWith('./') && !source.startsWith('../')) return false;
			return candidates(path.posix.join(directory, source)).some((file) =>
				matchesAny(file, leaves)
			);
		};
		const check = (node, source) => {
			if (source?.type === 'Literal' && typeof source.value === 'string' && allowed(source.value)) {
				return;
			}
			const shown = source?.type === 'Literal' ? String(source.value) : 'a computed import';
			context.report({ node, messageId: 'leafImport', data: { source: shown } });
		};
		return {
			ImportDeclaration(node) {
				check(node, node.source);
			},
			ExportNamedDeclaration(node) {
				if (node.source) check(node, node.source);
			},
			ExportAllDeclaration(node) {
				check(node, node.source);
			},
			ImportExpression(node) {
				check(node, node.source);
			}
		};
	}
};
