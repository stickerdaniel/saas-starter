/**
 * ESLint rule: require-returns-validator
 *
 * Requires a `returns` validator on every Convex function registration
 * (`query`, `mutation`, `action`, their `internal*` variants, and the
 * project's custom builders `authedQuery`/`authedMutation`/`adminQuery`/
 * `adminMutation`).
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
 */

const CONVEX_REGISTRARS = new Set([
	'query',
	'mutation',
	'action',
	'internalQuery',
	'internalMutation',
	'internalAction',
	'authedQuery',
	'authedMutation',
	'adminQuery',
	'adminMutation'
]);

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
		schema: [],
		messages: {
			missingReturns:
				'Convex function registration is missing a `returns` validator. Use `returns: v.null()` for functions that return nothing, or `returns: v.any()` with a why-comment for component-owned shapes.'
		}
	},
	create(context) {
		return {
			CallExpression(node) {
				const callee = node.callee;
				if (callee?.type !== 'Identifier' || !CONVEX_REGISTRARS.has(callee.name)) return;

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
