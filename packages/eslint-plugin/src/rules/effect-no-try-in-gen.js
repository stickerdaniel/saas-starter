import { inScope, isEffectMember, resolveEffect, scopeSchema } from '../effect-scope.js';

const FUNCTION_TYPES = new Set([
	'FunctionDeclaration',
	'FunctionExpression',
	'ArrowFunctionExpression'
]);

function containsOwnDelegatingYield(node) {
	if (!node || typeof node.type !== 'string') return false;
	if (node.type === 'YieldExpression' && node.delegate) return true;
	if (FUNCTION_TYPES.has(node.type)) return false;
	return Object.entries(node).some(([key, value]) => {
		if (key === 'parent') return false;
		if (Array.isArray(value)) return value.some(containsOwnDelegatingYield);
		return value !== null && typeof value === 'object' && containsOwnDelegatingYield(value);
	});
}

export default {
	meta: {
		type: 'problem',
		docs: { description: 'Disallow try statements around yield* in Effect generators' },
		schema: scopeSchema,
		messages: {
			tryInGen:
				'A `try` around `yield*` sees neither typed failures nor interruption: Effect delivers them through the fiber, not as throws. Handle failures with `Effect.catchTag`, `Effect.catch` or `Effect.result`, and cleanup with `Effect.ensuring` or `Effect.addFinalizer`.'
		}
	},
	create(context) {
		if (!inScope(context)) return {};
		const isGeneratorFactory = (callee) =>
			isEffectMember(resolveEffect(context, callee), 'Effect', ['gen', 'fn', 'fnUntraced']);
		const isFactoryArgument = (node) => {
			const call = node.parent;
			if (call?.type !== 'CallExpression' || !call.arguments.includes(node)) return false;
			if (isGeneratorFactory(call.callee)) return true;
			return call.callee.type === 'CallExpression' && isGeneratorFactory(call.callee.callee);
		};
		const bindingOf = (fn) => {
			if (fn.type === 'FunctionDeclaration') return fn;
			if (fn.parent?.type === 'VariableDeclarator' && fn.parent.init === fn) return fn.parent;
			return undefined;
		};
		const isEffectGenerator = (fn) => {
			if (!fn.generator) return false;
			if (fn.type === 'FunctionExpression' && isFactoryArgument(fn)) return true;
			const binding = bindingOf(fn);
			if (!binding) return false;
			return context.sourceCode
				.getDeclaredVariables(binding)
				.some((variable) =>
					variable.references.some((reference) => isFactoryArgument(reference.identifier))
				);
		};
		return {
			TryStatement(node) {
				const enclosing = context.sourceCode
					.getAncestors(node)
					.findLast((ancestor) => FUNCTION_TYPES.has(ancestor.type));
				if (enclosing && isEffectGenerator(enclosing) && containsOwnDelegatingYield(node)) {
					context.report({ node, messageId: 'tryInGen' });
				}
			}
		};
	}
};
