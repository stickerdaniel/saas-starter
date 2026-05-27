/**
 * ESLint rule: no-debounce-in-rune
 *
 * Forbids calling the function returned by runed's `useDebounce(...)` (including
 * `.cancel()`) from inside a Svelte rune (`$effect`, `$effect.pre`, `$effect.root`,
 * `$derived`, `$derived.by`).
 *
 * Why: `useDebounce` stores its timer state in an internal `$state` that the
 * returned function both reads and writes on every call. Calling it inside a rune
 * makes the rune depend on that `$state` and then invalidate it, looping until
 * `effect_update_depth_exceeded` (see the #402 regression in the support widget).
 *
 * ❌ const f = useDebounce(fn, 300); $effect(() => { f(); return () => f.cancel(); });
 * ✅ const d = new Debounced(() => value, 300);   // reactive debounced value
 * ✅ $effect(() => { const t = setTimeout(fn, 300); return () => clearTimeout(t); });
 * ✅ <button onclick={() => f()}>                  // event handler, not a rune
 */

const DEBOUNCE_FACTORIES = new Set(['useDebounce']);
const RUNE_ROOTS = new Set(['$effect', '$derived']);

/** Is this CallExpression a rune call: $effect(), $effect.pre(), $derived(), $derived.by()? */
function isRuneCall(node) {
	const callee = node.callee;
	if (!callee) return false;
	if (callee.type === 'Identifier') return RUNE_ROOTS.has(callee.name);
	if (
		callee.type === 'MemberExpression' &&
		callee.object?.type === 'Identifier' &&
		RUNE_ROOTS.has(callee.object.name)
	) {
		return true;
	}
	return false;
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow calling a useDebounce() result inside a Svelte rune ($effect/$derived)'
		},
		schema: [],
		messages: {
			debounceInRune:
				"Do not call a useDebounce() result inside $effect/$derived. It reads and writes the debouncer's internal $state, which loops (effect_update_depth_exceeded). Use the `Debounced` class for a reactive debounced value, or a plain setTimeout + clearTimeout for a one-shot timer."
		}
	},
	create(context) {
		// Identifiers bound to a `useDebounce(...)` result. `const` is declared before
		// use (TDZ), so a single top-down pass always records the name before any call.
		const debouncedNames = new Set();
		// Stack of rune CallExpression nodes currently being traversed.
		const runeStack = [];

		/** Returns the debounced identifier name being called (f() or f.cancel()), or null. */
		function calledDebouncedName(node) {
			const callee = node.callee;
			if (!callee) return null;
			// f(...)
			if (callee.type === 'Identifier' && debouncedNames.has(callee.name)) {
				return callee.name;
			}
			// f.cancel(...), f.runScheduledNow(...), etc.
			if (
				callee.type === 'MemberExpression' &&
				callee.object?.type === 'Identifier' &&
				debouncedNames.has(callee.object.name)
			) {
				return callee.object.name;
			}
			return null;
		}

		return {
			VariableDeclarator(node) {
				if (
					node.init?.type === 'CallExpression' &&
					node.init.callee?.type === 'Identifier' &&
					DEBOUNCE_FACTORIES.has(node.init.callee.name) &&
					node.id?.type === 'Identifier'
				) {
					debouncedNames.add(node.id.name);
				}
			},
			CallExpression(node) {
				if (isRuneCall(node)) {
					runeStack.push(node);
					return;
				}
				if (runeStack.length > 0 && calledDebouncedName(node)) {
					context.report({ node, messageId: 'debounceInRune' });
				}
			},
			'CallExpression:exit'(node) {
				if (runeStack[runeStack.length - 1] === node) {
					runeStack.pop();
				}
			}
		};
	}
};
