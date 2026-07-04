/**
 * ESLint rule: no-frozen-auth-page-data
 *
 * Forbids reading auth/billing state from `page.data` (or the `data` prop) in
 * code that renders on marketing pages. Marketing pages are prerendered, which
 * freezes the root layout's server data at build time: `page.data.viewer` is
 * null, `page.data.authState.isAuthenticated` is false, and
 * `page.data.autumnState` never updates. Components on those pages must read
 * from the client-recovering primitives instead (prerendering constraints in
 * AGENTS.md; regression class from saas-starter #452).
 *
 * ❌ const viewer = page.data.viewer;
 * ❌ if (data.authState.isAuthenticated) { ... }
 * ❌ const products = page.data.autumnState?.products;
 * ✅ authClient.useSession()  // profile data, recovers via cookies
 * ✅ useAuth()                // auth state, recovers via cookies
 * ✅ useCustomer()            // billing state, recovers via subscription
 *
 * Scope: only the marketing surface (marketing routes, marketing components,
 * and the customer-support widget, which renders on marketing pages). The
 * parallel /app and /admin fresh layout loads make page.data auth reads safe
 * there, so those routes are intentionally out of scope.
 *
 * Limitation: this matches the member chains `page.data.<prop>` / `$page.data.<prop>`
 * and the bare `data.<prop>` prop by identifier name. It does NOT do data-flow
 * analysis, so a local variable coincidentally named `page` or `data` would also
 * be matched. Given the narrow marketing-surface scope this is acceptable.
 */

import path from 'node:path';

// Frozen auth/billing fields on the prerendered root layout's server data, and
// the client-recovering primitive that replaces each one.
const FROZEN_FIELDS = {
	viewer: 'authClient.useSession() (from $lib/auth-client) for profile data',
	authState: 'useAuth() (from @mmailaender/convex-better-auth-svelte/svelte) for auth state',
	autumnState:
		'useCustomer() (from @stickerdaniel/convex-autumn-svelte/sveltekit) for billing state'
};

// `page` from $app/state, or `$page` from the deprecated $app/stores.
const PAGE_OBJECT_NAMES = new Set(['page', '$page']);

// Marketing-surface path fragments (forward-slash normalized). The customer-support
// widget renders on marketing pages, so it is included, as is src/blocks: the
// hero/pricing/cta/faq marketing blocks render on the prerendered home page
// (pricing-three is the canonical frozen-billing case this rule exists for).
const MARKETING_SURFACE_FRAGMENTS = [
	'src/routes/[[lang]]/(marketing)/',
	'src/lib/components/marketing/',
	'src/lib/components/customer-support/',
	'src/blocks/'
];

/** Resolves the accessed property name for both `a.b` and `a['b']`, else null. */
function propertyName(memberNode) {
	const prop = memberNode.property;
	if (!prop) return null;
	if (!memberNode.computed && prop.type === 'Identifier') return prop.name;
	if (memberNode.computed && prop.type === 'Literal' && typeof prop.value === 'string') {
		return prop.value;
	}
	return null;
}

/** Is `objNode` the `page.data` / `$page.data` member chain? */
function isPageDataChain(objNode) {
	return (
		objNode?.type === 'MemberExpression' &&
		propertyName(objNode) === 'data' &&
		objNode.object?.type === 'Identifier' &&
		PAGE_OBJECT_NAMES.has(objNode.object.name)
	);
}

/** Is `objNode` the bare `data` prop identifier? */
function isDataProp(objNode) {
	return objNode?.type === 'Identifier' && objNode.name === 'data';
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow reading frozen auth/billing fields (viewer, authState, autumnState) from page.data on prerendered marketing pages'
		},
		schema: [],
		messages: {
			frozenAuthRead:
				"'{{field}}' from page.data is frozen at build time on prerendered marketing pages. Use {{replacement}}, which recovers client-side after hydration."
		}
	},
	create(context) {
		const filename = (context.filename ?? context.getFilename()).split(path.sep).join('/');
		const onMarketingSurface = MARKETING_SURFACE_FRAGMENTS.some((f) => filename.includes(f));
		if (!onMarketingSurface) {
			return {};
		}

		return {
			MemberExpression(node) {
				const field = propertyName(node);
				if (!field || !(field in FROZEN_FIELDS)) return;
				if (isPageDataChain(node.object) || isDataProp(node.object)) {
					context.report({
						node,
						messageId: 'frozenAuthRead',
						data: { field, replacement: FROZEN_FIELDS[field] }
					});
				}
			}
		};
	}
};
