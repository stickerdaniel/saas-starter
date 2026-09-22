const EXEMPT_PATH = /(?:\/components\/ui\/)/u;

function posixFilename(context) {
	return String(context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
}

function importedName(node) {
	if (node?.type === 'Identifier') return node.name;
	if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
	return null;
}

function propertyName(node) {
	if (node?.computed) return importedName(node.property);
	return node?.property?.type === 'Identifier' ? node.property.name : importedName(node?.property);
}

function hasSliderProperty(pattern) {
	return (
		pattern?.type === 'ObjectPattern' &&
		pattern.properties.some((property) => {
			if (property.type !== 'Property') return false;
			return importedName(property.key) === 'Slider';
		})
	);
}

function unwrapExpression(node) {
	let current = node;
	while (current?.type === 'AwaitExpression' || current?.type === 'ChainExpression') {
		current = current.type === 'AwaitExpression' ? current.argument : current.expression;
	}
	return current;
}

function isBitsImportExpression(node) {
	const expression = unwrapExpression(node);
	return expression?.type === 'ImportExpression' && expression.source?.value === 'bits-ui';
}

function findVariable(scope, name) {
	let current = scope;
	while (current) {
		const variable = current.set?.get(name);
		if (variable) return variable;
		current = current.upper;
	}
	return null;
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
				'Import Slider from $lib/components/ui/slider/index.js instead of bits-ui.'
		}
	},
	create(context) {
		if (EXEMPT_PATH.test(posixFilename(context))) return {};

		const sourceCode = context.sourceCode ?? context.getSourceCode();
		const namespaceVariables = new WeakSet();

		function report(node) {
			context.report({ node, messageId: 'directSliderImport' });
		}

		function rememberDeclaredVariable(node, name) {
			const variable = sourceCode
				.getDeclaredVariables(node)
				.find((candidate) => candidate.name === name);
			if (variable) namespaceVariables.add(variable);
		}

		function isBitsNamespaceIdentifier(node) {
			if (node?.type !== 'Identifier') return false;
			const variable = findVariable(sourceCode.getScope(node), node.name);
			return variable ? namespaceVariables.has(variable) : false;
		}

		function isBitsNamespaceExpression(node) {
			return isBitsImportExpression(node) || isBitsNamespaceIdentifier(unwrapExpression(node));
		}

		return {
			ImportDeclaration(node) {
				if (node.source.value !== 'bits-ui' || node.importKind === 'type') return;
				for (const specifier of node.specifiers) {
					if (specifier.type === 'ImportNamespaceSpecifier') {
						rememberDeclaredVariable(node, specifier.local.name);
					} else if (
						specifier.type === 'ImportSpecifier' &&
						specifier.importKind !== 'type' &&
						importedName(specifier.imported) === 'Slider'
					) {
						report(specifier);
					}
				}
			},
			ExportNamedDeclaration(node) {
				if (node.source?.value !== 'bits-ui' || node.exportKind === 'type') return;
				for (const specifier of node.specifiers) {
					if (specifier.exportKind !== 'type' && importedName(specifier.local) === 'Slider') {
						report(specifier);
					}
				}
			},
			ExportAllDeclaration(node) {
				if (node.source.value === 'bits-ui' && node.exportKind !== 'type') {
					report(node);
				}
			},
			VariableDeclarator(node) {
				if (node.id.type === 'Identifier' && isBitsImportExpression(node.init)) {
					rememberDeclaredVariable(node, node.id.name);
					return;
				}
				if (hasSliderProperty(node.id) && isBitsNamespaceExpression(node.init)) {
					report(node.id);
				}
			},
			AssignmentExpression(node) {
				if (hasSliderProperty(node.left) && isBitsNamespaceExpression(node.right)) {
					report(node.left);
				}
			},
			CallExpression(node) {
				if (
					node.callee.type !== 'MemberExpression' ||
					propertyName(node.callee) !== 'then' ||
					!isBitsImportExpression(node.callee.object)
				) {
					return;
				}
				const callback = node.arguments[0];
				if (
					callback?.type !== 'ArrowFunctionExpression' &&
					callback?.type !== 'FunctionExpression'
				) {
					return;
				}
				const parameter = callback.params[0];
				if (hasSliderProperty(parameter)) {
					report(parameter);
				} else if (parameter?.type === 'Identifier') {
					rememberDeclaredVariable(callback, parameter.name);
				}
			},
			MemberExpression(node) {
				if (propertyName(node) === 'Slider' && isBitsNamespaceExpression(node.object)) {
					report(node);
				}
			}
		};
	}
};
