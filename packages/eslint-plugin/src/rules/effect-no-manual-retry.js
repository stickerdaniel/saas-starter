import { inScope, propertyName, scopeSchema } from '../effect-scope.js';

const LOOPS = [
	'ForStatement',
	'ForInStatement',
	'ForOfStatement',
	'WhileStatement',
	'DoWhileStatement'
];
const WAITS = new Set(['setTimeout', 'setInterval', 'sleep', 'delay', 'wait']);

export default {
	meta: {
		type: 'problem',
		docs: { description: 'Disallow hand-written retry loops' },
		schema: scopeSchema,
		messages: {
			manualRetry:
				'This loop catches a failure and waits before it tries again: a hand-written retry. Use `withRetry(effect, { schedule, times, while })` from src/lib/effect/retry.ts, which runs its delays on the fiber Clock and stops on interruption.'
		}
	},
	create(context) {
		if (!inScope(context)) return {};
		const frames = [];
		const mark = (flag) => {
			const frame = frames.at(-1);
			if (frame) frame[flag] = true;
		};
		const enter = () => frames.push({ catches: false, waits: false });
		const exit = (node) => {
			const frame = frames.pop();
			if (frame.catches && frame.waits) {
				context.report({ node, messageId: 'manualRetry' });
				return;
			}
			const parent = frames.at(-1);
			if (!parent) return;
			parent.catches ||= frame.catches;
			parent.waits ||= frame.waits;
		};
		const waitName = (callee) =>
			callee.type === 'Identifier' ? callee.name : propertyName(callee);
		return {
			...Object.fromEntries(
				LOOPS.flatMap((type) => [
					[type, enter],
					[`${type}:exit`, exit]
				])
			),
			CatchClause() {
				mark('catches');
			},
			CallExpression(node) {
				const name = waitName(node.callee);
				if (name === 'catch' && node.callee.type === 'MemberExpression') mark('catches');
				if (name && WAITS.has(name)) mark('waits');
			}
		};
	}
};
