const SPEC = /(^|\/)[^/]+\.spec(\.[cm]?[jt]s)?$|(^|\/)_generated\/(spec|refs)(\.[cm]?[jt]s)?$/;
const CONFECT_RUNTIME = /^@confect\/server(\/|$)|(^|\/)_generated\/registeredFunctions(\/|$)/;

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Keep plain Convex definitions under src/lib/confect free of runtime spec imports, generated registrations and @confect/server'
		},
		schema: [],
		messages: {
			runtimeSpec:
				'A plain Convex definition loads in its native module under src/lib/convex and in the generated Confect registration, so it imports a spec only as `import type { ... }`. `{{source}}` would put the spec graph into every function that imports this module; an inline `import { type X }` still loads it.',
			confectRuntime:
				'A plain Convex definition loads in its native module under src/lib/convex and in the generated Confect registration, so it imports nothing from `@confect/server` or `_generated/registeredFunctions`. `{{source}}` would load the Confect runtime or a registration cycle; Confect code belongs in the `.impl.ts` module.'
		}
	},
	create(context) {
		const check = (node, source, typeOnly) => {
			if (source?.type !== 'Literal' || typeof source.value !== 'string') return;
			const messageId = CONFECT_RUNTIME.test(source.value)
				? 'confectRuntime'
				: SPEC.test(source.value) && !typeOnly
					? 'runtimeSpec'
					: undefined;
			if (messageId) context.report({ node, messageId, data: { source: source.value } });
		};
		return {
			ImportDeclaration(node) {
				check(node, node.source, node.importKind === 'type');
			},
			ExportNamedDeclaration(node) {
				if (node.source) check(node, node.source, node.exportKind === 'type');
			},
			ExportAllDeclaration(node) {
				check(node, node.source, node.exportKind === 'type');
			},
			ImportExpression(node) {
				check(node, node.source, false);
			}
		};
	}
};
