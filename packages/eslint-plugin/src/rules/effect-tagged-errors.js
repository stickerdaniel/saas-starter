import { inScope, isGlobal, scopeSchema } from '../effect-scope.js';

const BUILTIN_ERRORS = new Set([
	'Error',
	'AggregateError',
	'EvalError',
	'RangeError',
	'ReferenceError',
	'SyntaxError',
	'TypeError',
	'URIError'
]);

export default {
	meta: {
		type: 'problem',
		docs: { description: 'Require tagged errors instead of Error subclasses in Effect code' },
		schema: scopeSchema,
		messages: {
			errorSubclass:
				"An `Error` subclass carries no `_tag`, so `Effect.catchTag` and the error codecs cannot select it. Extend `Data.TaggedError('Name')` from 'effect/Data', or reuse a shared error from src/lib/effect/errors.ts."
		}
	},
	create(context) {
		if (!inScope(context)) return {};
		const check = (node) => {
			const superClass = node.superClass;
			if (
				superClass?.type === 'Identifier' &&
				BUILTIN_ERRORS.has(superClass.name) &&
				isGlobal(context, superClass)
			) {
				context.report({ node, messageId: 'errorSubclass' });
			}
		};
		return { ClassDeclaration: check, ClassExpression: check };
	}
};
