const EXEMPT_PATH = /(?:\/components\/ui\/)/u;

function posixFilename(context) {
	return String(context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
}

function importedName(node) {
	if (node?.type === 'Identifier') return node.name;
	if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
	return null;
}

function unwrapExpression(node) {
	let current = node;
	while (
		current?.type === 'AwaitExpression' ||
		current?.type === 'ChainExpression' ||
		current?.type === 'TSAsExpression' ||
		current?.type === 'TSSatisfiesExpression' ||
		current?.type === 'TSTypeAssertion' ||
		current?.type === 'TSNonNullExpression'
	) {
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

function containingStatement(node) {
	let current = node;
	while (current?.parent) {
		if (
			(current.parent.type === 'Program' || current.parent.type === 'BlockStatement') &&
			current.parent.body.includes(current)
		) {
			return { container: current.parent, statement: current };
		}
		if (
			current.parent.type === 'IfStatement' ||
			current.parent.type === 'ConditionalExpression' ||
			current.parent.type === 'SwitchCase' ||
			current.parent.type === 'ForStatement' ||
			current.parent.type === 'ForInStatement' ||
			current.parent.type === 'ForOfStatement' ||
			current.parent.type === 'WhileStatement' ||
			current.parent.type === 'DoWhileStatement'
		) {
			return null;
		}
		current = current.parent;
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

		function report(node) {
			context.report({ node, messageId: 'directSliderImport' });
		}

		function variableForIdentifier(node) {
			if (node?.type !== 'Identifier') return null;
			return findVariable(sourceCode.getScope(node), node.name);
		}

		function reachingExpressions(node) {
			const variable = variableForIdentifier(node);
			if (!variable) return [];

			const usageStatement = containingStatement(node);
			const writes = [];
			for (const definition of variable.defs) {
				if (
					definition.type === 'Variable' &&
					definition.name?.type === 'Identifier' &&
					definition.node?.id === definition.name &&
					definition.node.init
				) {
					writes.push({ identifier: definition.name, expression: definition.node.init });
				}
			}
			for (const reference of variable.references) {
				if (reference.isWrite() && reference.writeExpr) {
					writes.push({ identifier: reference.identifier, expression: reference.writeExpr });
				}
			}

			let priorWrites = writes
				.filter((write) => write.identifier.range[0] < node.range[0])
				.sort((left, right) => left.identifier.range[0] - right.identifier.range[0]);
			if (priorWrites.length === 0) {
				priorWrites = writes.filter((write) =>
					variable.defs.some((definition) => definition.name === write.identifier)
				);
			}
			let lastStraightLineIndex = -1;
			if (usageStatement) {
				for (let index = 0; index < priorWrites.length; index += 1) {
					const writeStatement = containingStatement(priorWrites[index].identifier);
					if (
						writeStatement?.container === usageStatement.container &&
						writeStatement.statement.range[0] < usageStatement.statement.range[0]
					) {
						lastStraightLineIndex = index;
					}
				}
			}

			return priorWrites
				.slice(lastStraightLineIndex < 0 ? 0 : lastStraightLineIndex)
				.map((write) => write.expression);
		}

		function resolveStaticString(node, seenVariables = new Set()) {
			const expression = unwrapExpression(node);
			if (expression?.type === 'Literal' && typeof expression.value === 'string') {
				return expression.value;
			}
			if (expression?.type === 'TemplateLiteral' && expression.expressions.length === 0) {
				return expression.quasis[0]?.value.cooked ?? null;
			}
			const variable = variableForIdentifier(expression);
			if (!variable || seenVariables.has(variable)) return null;
			seenVariables.add(variable);
			for (const definition of variable.defs) {
				if (
					definition.type === 'Variable' &&
					definition.name?.type === 'Identifier' &&
					definition.node?.id === definition.name &&
					definition.parent?.kind === 'const'
				) {
					return resolveStaticString(definition.node.init, seenVariables);
				}
			}
			return null;
		}

		function propertyName(node) {
			if (node?.computed) return resolveStaticString(node.property);
			return node?.property?.type === 'Identifier'
				? node.property.name
				: importedName(node?.property);
		}

		function patternPropertyName(property) {
			return property.computed ? resolveStaticString(property.key) : importedName(property.key);
		}

		function hasSliderProperty(pattern) {
			return (
				pattern?.type === 'ObjectPattern' &&
				pattern.properties.some(
					(property) => property.type === 'Property' && patternPropertyName(property) === 'Slider'
				)
			);
		}

		function isBitsImportPromiseExpression(node, seenVariables = new Set()) {
			const expression = unwrapExpression(node);
			if (isBitsImportExpression(expression)) return true;
			const variable = variableForIdentifier(expression);
			if (!variable || seenVariables.has(variable)) return false;
			const nextSeenVariables = new Set(seenVariables).add(variable);
			return reachingExpressions(expression).some((value) =>
				isBitsImportPromiseExpression(value, nextSeenVariables)
			);
		}

		function isBitsThenCallbackParameter(variable, seenVariables) {
			return variable.defs.some((definition) => {
				if (definition.type !== 'Parameter' || definition.name?.type !== 'Identifier') return false;
				const callback = definition.node;
				const call = callback?.parent;
				return (
					call?.type === 'CallExpression' &&
					call.arguments[0] === callback &&
					call.callee.type === 'MemberExpression' &&
					propertyName(call.callee) === 'then' &&
					isBitsImportPromiseExpression(call.callee.object, seenVariables)
				);
			});
		}

		function isBitsNamespaceExpression(node, seenVariables = new Set()) {
			const expression = unwrapExpression(node);
			if (isBitsImportExpression(expression)) return true;
			const variable = variableForIdentifier(expression);
			if (!variable || seenVariables.has(variable)) return false;
			const nextSeenVariables = new Set(seenVariables).add(variable);
			if (
				variable.defs.some(
					(definition) =>
						definition.type === 'ImportBinding' &&
						definition.node?.type === 'ImportNamespaceSpecifier' &&
						definition.parent?.source?.value === 'bits-ui'
				)
			) {
				return true;
			}
			if (isBitsThenCallbackParameter(variable, nextSeenVariables)) return true;
			return reachingExpressions(expression).some((value) =>
				isBitsNamespaceExpression(value, nextSeenVariables)
			);
		}

		function exportedVariableDeclaration(node) {
			for (const declaration of node.declarations) {
				if (declaration.id.type === 'Identifier' && isBitsNamespaceExpression(declaration.init)) {
					report(declaration.id);
				}
			}
		}

		return {
			ImportDeclaration(node) {
				if (node.source.value !== 'bits-ui' || node.importKind === 'type') return;
				for (const specifier of node.specifiers) {
					if (
						specifier.type === 'ImportSpecifier' &&
						specifier.importKind !== 'type' &&
						importedName(specifier.imported) === 'Slider'
					) {
						report(specifier);
					}
				}
			},
			ExportNamedDeclaration(node) {
				if (node.exportKind === 'type') return;
				if (node.source?.value === 'bits-ui') {
					for (const specifier of node.specifiers) {
						if (specifier.exportKind !== 'type' && importedName(specifier.local) === 'Slider') {
							report(specifier);
						}
					}
					return;
				}
				if (node.source) return;
				if (node.declaration?.type === 'VariableDeclaration') {
					exportedVariableDeclaration(node.declaration);
				}
				for (const specifier of node.specifiers) {
					if (specifier.exportKind !== 'type' && isBitsNamespaceExpression(specifier.local)) {
						report(specifier);
					}
				}
			},
			ExportDefaultDeclaration(node) {
				if (isBitsNamespaceExpression(node.declaration)) report(node.declaration);
			},
			ExportAllDeclaration(node) {
				if (node.source.value === 'bits-ui' && node.exportKind !== 'type') {
					report(node);
				}
			},
			VariableDeclarator(node) {
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
					!isBitsImportPromiseExpression(node.callee.object)
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
				if (hasSliderProperty(parameter)) report(parameter);
			},
			MemberExpression(node) {
				if (propertyName(node) === 'Slider' && isBitsNamespaceExpression(node.object)) {
					report(node);
				}
			},
			SvelteMemberExpressionName(node) {
				if (node.property?.name === 'Slider' && isBitsNamespaceExpression(node.object)) {
					report(node);
				}
			}
		};
	}
};
