/**
 * ESLint rule: require-returns-validator
 *
 * Requires a `returns` validator on every Convex function registration. The
 * `builders` option names the registration builders to check. It defaults to
 * Convex's own `query`, `mutation`, `action` and their `internal*` variants; a
 * project with custom builders passes the complete list.
 *
 * Why: the convex-guidelines skill mandates a `returns` validator on every
 * function. Without one, the return shape is undocumented, unvalidated at
 * runtime, and the omission spreads because Convex files are the most-copied
 * pattern in the repo (#461). Use `returns: v.null()` for functions that
 * return nothing, and `v.any()` with a short why-comment for shapes owned by
 * a component (Better Auth user docs, agent messages).
 *
 * ❌ export const f = query({ args: {}, handler: async () => null });
 * ✅ export const f = query({ args: {}, returns: v.null(), handler: async () => null });
 *
 * Config: 'local/require-returns-validator': ['error', { builders: ['query', 'checkedQuery'] }]
 */

const CONVEX_BUILDERS = [
	'query',
	'mutation',
	'action',
	'internalQuery',
	'internalMutation',
	'internalAction'
];

/** Property key name for both identifier and string-literal keys. */
function keyName(property) {
	if (property.key?.type === 'Identifier') return property.key.name;
	if (property.key?.type === 'Literal') return String(property.key.value);
	return null;
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Require a `returns` validator on every Convex function registration'
		},
		schema: [
			{
				type: 'object',
				properties: {
					builders: { type: 'array', items: { type: 'string' }, uniqueItems: true }
				},
				additionalProperties: false
			}
		],
		messages: {
			missingReturns:
				'Convex function registration is missing a `returns` validator. Use `returns: v.null()` for functions that return nothing, or `returns: v.any()` with a why-comment for component-owned shapes.'
		}
	},
	create(context) {
		const builders = new Set(context.options?.[0]?.builders ?? CONVEX_BUILDERS);
		return {
			CallExpression(node) {
				const callee = node.callee;
				if (callee?.type !== 'Identifier' || !builders.has(callee.name)) return;

				const config = node.arguments?.[0];
				// Only object-literal registrations can be checked statically.
				if (!config || config.type !== 'ObjectExpression') return;

				let hasSpread = false;
				for (const property of config.properties) {
					if (property.type === 'SpreadElement') {
						hasSpread = true;
						continue;
					}
					if (keyName(property) === 'returns') return;
				}

				// A spread may carry the validator; skip to avoid false positives.
				if (hasSpread) return;

				context.report({ node: config, messageId: 'missingReturns' });
			}
		};
	}
};
