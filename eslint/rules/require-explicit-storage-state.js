/**
 * ESLint rule: require-explicit-storage-state
 *
 * Requires every `newContext()` call in a Playwright e2e spec to pass an object
 * literal with its own `storageState` property.
 *
 * Why: Playwright Test fills every option a spec omits from the project's
 * `use` block, including `storageState`, so a context opened from the `browser`
 * fixture in `chromium` or `chromium-admin` is already signed in. The
 * read-receipt spec's "anonymous customer" was the admin; the bootstrap migrated
 * the seeded ticket onto that account and later runs saw two unread messages.
 *
 * `request.newContext()` and `playwright.request.newContext()` build an
 * APIRequestContext, not a browser one, and are ignored. A spread or a variable
 * argument is reported unless the literal itself names `storageState`: the rule
 * cannot see through it, and naming the session at the call site is the point.
 *
 * ❌ await browser.newContext({ baseURL });
 * ✅ await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
 * ✅ await browser.newContext({ storageState: 'e2e/.auth/user.json' });
 */

function isRequestReceiver(node) {
	if (node?.type === 'Identifier') return node.name === 'request';
	return (
		node?.type === 'MemberExpression' &&
		!node.computed &&
		node.property?.type === 'Identifier' &&
		node.property.name === 'request'
	);
}

function namesStorageState(property) {
	if (property.type !== 'Property' || property.computed) return false;
	const key = property.key;
	return (
		(key.type === 'Identifier' && key.name === 'storageState') ||
		(key.type === 'Literal' && key.value === 'storageState')
	);
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Require an explicit storageState on browser contexts in e2e specs'
		},
		schema: [],
		messages: {
			missingStorageState:
				"A context from the browser fixture inherits the project's signed-in storageState. Name the session in the object literal: storageState: { cookies: [], origins: [] } for a signed-out actor, or the auth file for a signed-in one."
		}
	},
	create(context) {
		return {
			CallExpression(node) {
				const callee = node.callee;
				if (
					callee?.type !== 'MemberExpression' ||
					callee.computed ||
					callee.property?.type !== 'Identifier' ||
					callee.property.name !== 'newContext' ||
					isRequestReceiver(callee.object)
				) {
					return;
				}
				const [options] = node.arguments;
				if (options?.type === 'ObjectExpression' && options.properties.some(namesStorageState)) {
					return;
				}
				context.report({ node, messageId: 'missingStorageState' });
			}
		};
	}
};
