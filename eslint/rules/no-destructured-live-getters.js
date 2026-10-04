/**
 * ESLint rule: no-destructured-live-getters
 *
 * Flags destructuring a live getter out of `useAuth()` or `useCustomer()`.
 *
 * Why: both return objects whose `isAuthenticated`, `isLoading` and `customer`
 * are getters over reactive state. Destructuring reads them once, during setup,
 * so the component keeps the value it saw then: the pricing page sent a visitor
 * whose session recovered after mount to sign in again, and kept offering
 * checkout to a customer who had just become Pro. Functions such as
 * `openBillingPortal` are plain properties and may be destructured.
 *
 * Only a direct `const { … } = useAuth()` or `useCustomer()` is recognized;
 * aliases and destructuring a stored result later are out of scope.
 *
 * ❌ const { isAuthenticated } = useAuth();
 * ✅ const auth = useAuth(); ... auth.isAuthenticated
 * ✅ const { openBillingPortal } = useCustomer();
 */

const LIVE_GETTERS = {
	useAuth: new Set(['isAuthenticated', 'isLoading']),
	useCustomer: new Set(['customer'])
};

function propertyName(property) {
	if (property.type !== 'Property' || property.computed) return null;
	if (property.key.type === 'Identifier') return property.key.name;
	if (property.key.type === 'Literal') return String(property.key.value);
	return null;
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow destructuring live getters from useAuth() and useCustomer()'
		},
		schema: [],
		messages: {
			destructuredGetter:
				"'{{name}}' from {{hook}}() is a live getter; destructuring freezes the value read during setup. Keep the object (`const auth = {{hook}}()`) and read `auth.{{name}}` where it is used."
		}
	},
	create(context) {
		return {
			VariableDeclarator(node) {
				const init = node.init;
				if (
					node.id.type !== 'ObjectPattern' ||
					init?.type !== 'CallExpression' ||
					init.callee.type !== 'Identifier' ||
					!Object.hasOwn(LIVE_GETTERS, init.callee.name)
				) {
					return;
				}
				const getters = LIVE_GETTERS[init.callee.name];
				for (const property of node.id.properties) {
					const name = propertyName(property);
					if (name && getters.has(name)) {
						context.report({
							node: property,
							messageId: 'destructuredGetter',
							data: { name, hook: init.callee.name }
						});
					}
				}
			}
		};
	}
};
