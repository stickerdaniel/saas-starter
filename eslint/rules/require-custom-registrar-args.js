/**
 * ESLint rule: require-custom-registrar-args
 *
 * Requires an `args` validator on every registration through a custom builder
 * from `src/lib/convex/functions.ts` (CUSTOM_REGISTRARS). The upstream
 * `@convex-dev/require-args-validator` reads only Convex's own builders, so
 * without this rule an `authedMutation` accepts any arguments unvalidated.
 * Functions without arguments declare `args: {}`.
 *
 * Example: export const f = authedQuery({ args: {}, returns: v.null(), handler: async (ctx) => null });
 */

import { CUSTOM_REGISTRARS } from '../convex-registrars.js';

const REGISTRARS = new Set(CUSTOM_REGISTRARS);

/** Key name of a plain or string-literal key; null for a spread or computed key. */
function keyName(property) {
	if (property.type !== 'Property' || property.computed) return null;
	if (property.key.type === 'Identifier') return property.key.name;
	if (property.key.type === 'Literal') return String(property.key.value);
	return null;
}

function unwrap(node) {
	let result = node;
	while (
		result?.type === 'TSAsExpression' ||
		result?.type === 'TSSatisfiesExpression' ||
		result?.type === 'TSNonNullExpression' ||
		result?.type === 'TSTypeAssertion'
	) {
		result = result.expression;
	}
	return result;
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Require an `args` validator on custom Convex builder registrations'
		},
		schema: [],
		messages: {
			missingArgs:
				'`{{name}}` registration is missing an `args` validator. Declare the accepted arguments, or `args: {}` for none, so Convex rejects any other input.'
		}
	},
	create(context) {
		return {
			CallExpression(node) {
				const callee = node.callee;
				if (callee?.type !== 'Identifier' || !REGISTRARS.has(callee.name)) return;
				// The validator is a written `args` key; a spread or computed key does not count.
				const config = unwrap(node.arguments?.[0]);
				if (
					config?.type === 'ObjectExpression' &&
					config.properties.some((p) => keyName(p) === 'args')
				) {
					return;
				}
				context.report({
					node: config ?? node,
					messageId: 'missingArgs',
					data: { name: callee.name }
				});
			}
		};
	}
};
