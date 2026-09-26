/**
 * ESLint rule: no-dynamic-import-rejection-handler
 *
 * Flags a rejection handler passed to a `.then(...)` called directly on a
 * dynamic `import(...)`.
 *
 * Why: a client build wraps every dynamic import as
 * `__vitePreload(() => import(x), deps)` and moves a `.then(...)` sitting
 * directly on the import into that factory. Its rejection handler then settles
 * the failed chunk load before the wrapper sees it, so `vite:preloadError`
 * never fires and the stale-deploy reload in `src/app.html` is lost (#1026).
 * Handlers chained after that first call, `.catch(...)` included, and an
 * optional `?.then` or `.then?.()` stay outside the wrapper and still let the
 * event fire, so they are not flagged.
 *
 * A spread that hides the second argument (`.then(...handlers)`) is flagged:
 * it may supply a rejection handler, and the try/await form is always
 * available. A spread array literal is expanded and judged by its elements.
 *
 * ❌ import('./Editor.svelte').then((module) => module.default, onRejected);
 * ✅ try {
 *      const module = await import('./Editor.svelte');
 *      return module.default;
 *    } catch (error) { onRejected(error); }
 */
export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow a rejection handler in a .then() called directly on a dynamic import() (#1026)'
		},
		schema: [],
		messages: {
			rejectionHandlerOnImport:
				'Load the module with try { const module = await import(...); } catch (error) { ... } instead. Vite moves a .then() on import() inside its __vitePreload wrapper, so this rejection handler swallows the failed chunk load and vite:preloadError never triggers the stale-deploy reload (#1026).'
		}
	},
	create(context) {
		// A TypeScript cast leaves the emitted JavaScript unchanged.
		function unwrapTypeCast(node) {
			let current = node;
			while (
				current?.type === 'TSAsExpression' ||
				current?.type === 'TSSatisfiesExpression' ||
				current?.type === 'TSNonNullExpression'
			) {
				current = current.expression;
			}
			return current;
		}

		// Expands spread array literals into the arguments they supply. `complete`
		// is false once a spread of any other value hides the remaining positions.
		// An array hole stays in place as null, which spreads as undefined.
		function flattenArguments(args) {
			const flat = [];
			for (const arg of args) {
				if (arg?.type !== 'SpreadElement') {
					flat.push(arg);
					continue;
				}
				const spread = unwrapTypeCast(arg.argument);
				if (spread?.type !== 'ArrayExpression') return { flat, complete: false };
				const inner = flattenArguments(spread.elements);
				flat.push(...inner.flat);
				if (!inner.complete) return { flat, complete: false };
			}
			return { flat, complete: true };
		}

		// undefined, null, and void expressions leave the rejection unhandled.
		function isRejectionHandler(node) {
			const value = unwrapTypeCast(node);
			if (!value) return false;
			if (value.type === 'Identifier' && value.name === 'undefined') return false;
			if (value.type === 'Literal' && value.raw === 'null') return false;
			if (value.type === 'UnaryExpression' && value.operator === 'void') return false;
			return true;
		}

		return {
			CallExpression(node) {
				const callee = node.callee;
				if (
					node.optional ||
					callee?.type !== 'MemberExpression' ||
					callee.optional ||
					callee.computed ||
					callee.property?.type !== 'Identifier' ||
					callee.property.name !== 'then' ||
					unwrapTypeCast(callee.object)?.type !== 'ImportExpression'
				) {
					return;
				}

				const { flat, complete } = flattenArguments(node.arguments);
				const flagged = flat.length >= 2 ? isRejectionHandler(flat[1]) : !complete;
				if (flagged) {
					context.report({ node, messageId: 'rejectionHandlerOnImport' });
				}
			}
		};
	}
};
