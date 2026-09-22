import path from 'node:path';

const EXEMPT_PATH_PREFIX = 'src/lib/components/ui/';

function repositoryFilename(context) {
	const cwd = String(context.cwd ?? context.getCwd?.() ?? process.cwd());
	const filename = String(context.filename ?? context.getFilename?.() ?? '');
	return path.relative(cwd, path.resolve(cwd, filename)).replaceAll('\\', '/');
}

function importedName(node) {
	if (node?.type === 'Identifier') return node.name;
	if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
	return null;
}

function isBitsSource(node) {
	let source = node;
	while (
		source?.type === 'TSAsExpression' ||
		source?.type === 'TSSatisfiesExpression' ||
		source?.type === 'TSTypeAssertion' ||
		source?.type === 'TSNonNullExpression'
	) {
		source = source.expression;
	}
	if (source?.type === 'Literal') return source.value === 'bits-ui';
	return (
		source?.type === 'TemplateLiteral' &&
		source.expressions.length === 0 &&
		source.quasis[0]?.value.cooked === 'bits-ui'
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
		if (repositoryFilename(context).startsWith(EXEMPT_PATH_PREFIX)) return {};

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
