import { inScope, isGlobal, propertyName, scopeSchema } from '../effect-scope.js';

const TIMERS = new Set(['setTimeout', 'setInterval', 'setImmediate']);
const GLOBAL_OBJECTS = new Set(['globalThis', 'window', 'self', 'global']);

export default {
	meta: {
		type: 'problem',
		docs: { description: 'Disallow raw timers in Effect-owned code' },
		schema: scopeSchema,
		messages: {
			rawTimer:
				'`{{name}}` runs outside every fiber, so interruption and Lifetime.end() cannot cancel it and TestClock cannot drive it. Use `Effect.sleep`, a `Schedule`, or `lifetime.after(ms, fn)`.'
		}
	},
	create(context) {
		if (!inScope(context)) return {};
		const timerName = (callee) => {
			if (callee.type === 'Identifier') {
				return TIMERS.has(callee.name) && isGlobal(context, callee) ? callee.name : undefined;
			}
			const name = propertyName(callee);
			return name &&
				TIMERS.has(name) &&
				callee.object.type === 'Identifier' &&
				GLOBAL_OBJECTS.has(callee.object.name) &&
				isGlobal(context, callee.object)
				? name
				: undefined;
		};
		return {
			CallExpression(node) {
				const name = timerName(node.callee);
				if (name) context.report({ node, messageId: 'rawTimer', data: { name } });
			}
		};
	}
};
