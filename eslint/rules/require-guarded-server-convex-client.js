/**
 * ESLint rule: require-guarded-server-convex-client
 *
 * Flags `createServerConvexHttpClient(...)` constructed outside a try block or
 * an `Effect.gen(...).pipe(recoverWith(...), ...)` in a SvelteKit server load
 * (`+page.server.ts` / `+layout.server.ts`).
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
				'Require createServerConvexHttpClient() construction inside a try block or a recovered Effect.gen in SvelteKit server loads (#594)'
		},
		schema: [],
		messages: {
			unguardedConstruction:
				'createServerConvexHttpClient() throws synchronously when the Convex URL is unresolved (e.g. a freshly provisioned preview before env propagates). Construct it inside a try, or inside an Effect.gen whose first pipe step is recoverWith(...), so the SSR load degrades to a fallback instead of 500ing the page (#594). The per-query .catch does not cover the construction line.'
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

		function isEffectGen(node) {
			return (
				node?.type === 'CallExpression' &&
				node.callee?.type === 'MemberExpression' &&
				node.callee.object?.type === 'Identifier' &&
				node.callee.object.name === 'Effect' &&
				node.callee.property?.name === 'gen'
			);
		}

		function isRecoverWith(node) {
			return (
				node?.type === 'CallExpression' &&
				node.callee?.type === 'Identifier' &&
				node.callee.name === 'recoverWith'
			);
		}

		function isOrDie(node) {
			return (
				node?.type === 'MemberExpression' &&
				node.object?.type === 'Identifier' &&
				node.object.name === 'Effect' &&
				node.property?.name === 'orDie'
			);
		}

		function isPipedEffectGen(node) {
			return (
				node.type === 'CallExpression' &&
				node.callee?.type === 'MemberExpression' &&
				node.callee.property?.name === 'pipe' &&
				isEffectGen(node.callee.object)
			);
		}

		function isRecoveredEffectGen(node) {
			return isPipedEffectGen(node) && isRecoverWith(node.arguments[0]);
		}

		function isFunction(node) {
			return (
				node.type === 'FunctionExpression' ||
				node.type === 'ArrowFunctionExpression' ||
				node.type === 'FunctionDeclaration'
			);
		}

		function generatorBody(genCall) {
			const body = genCall.arguments.at(-1);
			return body?.type === 'FunctionExpression' && body.generator ? body : undefined;
		}

		function yieldedEffectGen(node) {
			if (node.type !== 'YieldExpression' || !node.delegate || !node.argument) return undefined;
			if (isEffectGen(node.argument)) return node.argument;
			return isPipedEffectGen(node.argument) &&
				node.argument.arguments.every((step) => isRecoverWith(step) || isOrDie(step))
				? node.argument.callee.object
				: undefined;
		}

		function children(node) {
			return Object.keys(node)
				.filter((key) => key !== 'parent' && key !== 'tokens' && key !== 'comments')
				.flatMap((key) =>
					(Array.isArray(node[key]) ? node[key] : [node[key]]).map((child) => [key, child])
				)
				.filter(
					([, child]) => child && typeof child === 'object' && typeof child.type === 'string'
				);
		}

		function walkEffectGen(genCall, guard, bodyGuard) {
			const body = generatorBody(genCall);
			for (const [, child] of children(genCall)) if (child !== body) walk(child, guard);
			if (body) for (const [, child] of children(body)) walk(child, bodyGuard);
		}

		function walk(node, guard) {
			if (isClientConstruction(node) && !guard.tryBlock && !guard.effect) {
				context.report({ node, messageId: 'unguardedConstruction' });
			}

			if (isRecoveredEffectGen(node)) {
				for (const [, child] of children(node)) if (child !== node.callee) walk(child, guard);
				walkEffectGen(node.callee.object, guard, { ...guard, effect: true });
				return;
			}

			const yielded = yieldedEffectGen(node);
			if (yielded) {
				if (yielded !== node.argument) {
					for (const [, child] of children(node.argument)) {
						if (child !== node.argument.callee) walk(child, guard);
					}
				}
				walkEffectGen(
					yielded,
					guard,
					isRecoveredEffectGen(node.argument) ? { ...guard, effect: true } : guard
				);
				return;
			}

			const inner = isFunction(node) ? { ...guard, effect: false } : guard;
			for (const [key, child] of children(node)) {
				// Only a try's protected `block` guards construction; descending
				// into `handler` (catch) or `finalizer` (finally) does not. Once
				// inside a guarded block, everything below stays guarded.
				const tryBlock = inner.tryBlock || (node.type === 'TryStatement' && key === 'block');
				walk(child, { ...inner, tryBlock });
			}
		}

		return {
			Program(node) {
				walk(node, { tryBlock: false, effect: false });
			}
		};
	}
};
