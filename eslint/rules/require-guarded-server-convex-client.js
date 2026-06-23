/**
 * ESLint rule: require-guarded-server-convex-client
 *
 * Flags `createServerConvexHttpClient(...)` constructed outside a try block in
 * a SvelteKit server load (`+page.server.ts` / `+layout.server.ts`).
 *
 * Why: the helper throws SYNCHRONOUSLY when the Convex URL is unresolved (a
 * missing CONVEX_INTERNAL_URL/PUBLIC_CONVEX_URL, which happens on a freshly
 * provisioned preview before env propagates). A per-query `.catch` does not
 * cover the construction line, so an unguarded `const client = create...()`
 * 500s the SSR page even though the client `useQuery` subscription would
 * recover the real data after hydration (#594). This bug fails silently in
 * local dev and review (env is always resolved there) and only surfaces on
 * cold previews, and the construct-then-catch shape is copy-pasted into every
 * new authenticated load, so it is a recurring class worth a structural guard.
 *
 * ❌ const client = createServerConvexHttpClient({ token });
 *    const data = await client.query(...).catch(() => fallback);
 * ✅ try {
 *      const client = createServerConvexHttpClient({ token });
 *      const data = await client.query(...);
 *      return { data };
 *    } catch (e) { return { data: fallback }; }
 *
 * The rule traverses downward from Program (instead of walking node.parent) so
 * it is self-contained and testable with the repo's parent-less rule harness.
 */
export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Require createServerConvexHttpClient() construction inside a try block in SvelteKit server loads (#594)'
		},
		schema: [],
		messages: {
			unguardedConstruction:
				'createServerConvexHttpClient() throws synchronously when the Convex URL is unresolved (e.g. a freshly provisioned preview before env propagates). Construct it inside a try so the SSR load degrades to a fallback instead of 500ing the page (#594). The per-query .catch does not cover the construction line.'
		}
	},
	create(context) {
		function isClientConstruction(node) {
			return (
				node.type === 'CallExpression' &&
				node.callee?.type === 'Identifier' &&
				node.callee.name === 'createServerConvexHttpClient'
			);
		}

		function walk(node, insideTry) {
			if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;

			if (isClientConstruction(node) && !insideTry) {
				context.report({ node, messageId: 'unguardedConstruction' });
			}

			for (const key of Object.keys(node)) {
				if (key === 'parent' || key === 'tokens' || key === 'comments') continue;
				const value = node[key];
				const children = Array.isArray(value) ? value : [value];
				for (const child of children) {
					if (!child || typeof child !== 'object' || typeof child.type !== 'string') continue;
					// Only a try's protected `block` guards construction; descending
					// into `handler` (catch) or `finalizer` (finally) does not. Once
					// inside a guarded block, everything below stays guarded.
					const childGuarded = insideTry || (node.type === 'TryStatement' && key === 'block');
					walk(child, childGuarded);
				}
			}
		}

		return {
			Program(node) {
				walk(node, false);
			}
		};
	}
};
