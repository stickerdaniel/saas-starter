import { inScope, isGlobal, propertyName, scopeSchema } from '../effect-scope.js';

export default {
	meta: {
		type: 'problem',
		docs: { description: 'Disallow Promise.race in Effect-owned code' },
		schema: scopeSchema,
		messages: {
			promiseRace:
				'Promise.race leaves the losing promise running and its timer armed. Use `within(effect, duration, onTimeout)` from src/lib/effect/timeout.ts or `Effect.race`, which interrupt the loser.'
		}
	},
	create(context) {
		if (!inScope(context)) return {};
		return {
			CallExpression(node) {
				const callee = node.callee;
				if (
					propertyName(callee) === 'race' &&
					callee.object.type === 'Identifier' &&
					callee.object.name === 'Promise' &&
					isGlobal(context, callee.object)
				) {
					context.report({ node, messageId: 'promiseRace' });
				}
			}
		};
	}
};
