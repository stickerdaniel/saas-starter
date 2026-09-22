const EXEMPT_PATH = /(?:\/components\/ui\/)/u;

function posixFilename(context) {
	return String(context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
}

function importedName(node) {
	if (node?.type === 'Identifier') return node.name;
	if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
	return null;
}

function isBitsSource(node) {
	if (node?.type === 'Literal') return node.value === 'bits-ui';
	return (
		node?.type === 'TemplateLiteral' &&
		node.expressions.length === 0 &&
		node.quasis[0]?.value.cooked === 'bits-ui'
	);
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Require the shadcn Slider wrapper instead of the bits-ui primitive'
		},
		schema: [],
		messages: {
			directSliderImport:
				'Import Slider from $lib/components/ui/slider/index.js instead of bits-ui.',
			staticBitsBoundary:
				'Use named Bits UI imports and the shadcn Slider wrapper so Slider enforcement remains statically decidable.'
		}
	},
	create(context) {
		if (EXEMPT_PATH.test(posixFilename(context))) return {};

		function reportSlider(node) {
			context.report({ node, messageId: 'directSliderImport' });
		}

		function reportBoundary(node) {
			context.report({ node, messageId: 'staticBitsBoundary' });
		}

		return {
			ImportDeclaration(node) {
				if (!isBitsSource(node.source) || node.importKind === 'type') return;
				for (const specifier of node.specifiers) {
					if (specifier.type === 'ImportNamespaceSpecifier') {
						reportBoundary(specifier);
					} else if (
						specifier.type === 'ImportSpecifier' &&
						specifier.importKind !== 'type' &&
						importedName(specifier.imported) === 'Slider'
					) {
						reportSlider(specifier);
					}
				}
			},
			ExportNamedDeclaration(node) {
				if (!isBitsSource(node.source) || node.exportKind === 'type') return;
				for (const specifier of node.specifiers) {
					if (specifier.exportKind !== 'type' && importedName(specifier.local) === 'Slider') {
						reportSlider(specifier);
					}
				}
			},
			ExportAllDeclaration(node) {
				if (isBitsSource(node.source) && node.exportKind !== 'type') reportBoundary(node);
			},
			ImportExpression(node) {
				if (isBitsSource(node.source)) reportBoundary(node);
			}
		};
	}
};
