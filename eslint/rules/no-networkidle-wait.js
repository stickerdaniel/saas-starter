/**
 * ESLint rule: no-networkidle-wait
 *
 * Flags Playwright waits on the `networkidle` load state in e2e code:
 * `waitForLoadState('networkidle')`, and `waitUntil: 'networkidle'` in the
 * options of `goto`, `waitForURL`, `reload`, `goBack`, `goForward`,
 * `waitForNavigation` and `setContent`.
 *
 * Why: network idle means no HTTP request for 500 ms. It ignores WebSocket
 * frames, so it resolves while Convex-driven state is still missing, and it
 * says nothing about the control a step is about to use. The checkout specs
 * waited on it before clicking a button that stayed disabled. A step is ready
 * when the condition it needs holds, so assert that condition instead.
 *
 * A test of quiescence itself may keep the wait behind an inline
 * `eslint-disable-next-line local/no-networkidle-wait -- <reason>` whose reason
 * names the behaviour that needs quiescence and why no positive condition can
 * observe it. "networkidle means hydrated" is not such a reason.
 *
 * Options passed through a variable are not followed; the rule recognizes the
 * literal call shapes only, so the string in comments or unrelated APIs is fine.
 *
 * ❌ await page.waitForLoadState('networkidle');
 * ❌ await page.goto('/en/pricing', { waitUntil: 'networkidle' });
 * ✅ await expect(page.getByTestId('pricing-checkout-pro')).toBeEnabled();
 * ✅ await page.goto('/en/admin/settings', { waitUntil: 'domcontentloaded' });
 */

const NAVIGATION_METHODS = new Set([
	'goto',
	'waitForURL',
	'reload',
	'goBack',
	'goForward',
	'waitForNavigation',
	'setContent'
]);

function isNetworkIdle(node) {
	if (node?.type === 'Literal') return node.value === 'networkidle';
	return (
		node?.type === 'TemplateLiteral' &&
		node.expressions.length === 0 &&
		node.quasis[0]?.value.cooked === 'networkidle'
	);
}

function waitsUntilNetworkIdle(property) {
	if (property.type !== 'Property' || property.computed) return false;
	const key = property.key;
	const named =
		(key.type === 'Identifier' && key.name === 'waitUntil') ||
		(key.type === 'Literal' && key.value === 'waitUntil');
	return named && isNetworkIdle(property.value);
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow networkidle as readiness in Playwright e2e code'
		},
		schema: [],
		messages: {
			networkIdleWait:
				'networkidle is not readiness: it ignores WebSocket traffic and says nothing about the control the next step uses. Assert a positive condition of the operation under test instead (an enabled control, a URL, rendered rows, or the dispatched request).'
		}
	},
	create(context) {
		return {
			CallExpression(node) {
				const callee = node.callee;
				if (
					callee?.type !== 'MemberExpression' ||
					callee.computed ||
					callee.property?.type !== 'Identifier'
				) {
					return;
				}
				const method = callee.property.name;
				if (method === 'waitForLoadState') {
					if (isNetworkIdle(node.arguments[0])) {
						context.report({ node, messageId: 'networkIdleWait' });
					}
					return;
				}
				if (!NAVIGATION_METHODS.has(method)) return;
				if (
					node.arguments.some(
						(argument) =>
							argument.type === 'ObjectExpression' &&
							argument.properties.some(waitsUntilNetworkIdle)
					)
				) {
					context.report({ node, messageId: 'networkIdleWait' });
				}
			}
		};
	}
};
