/**
 * ESLint rule: no-module-state-singleton
 *
 * Flags top-level `export const x = new SomeClass(...)` in `.svelte.ts`
 * modules, except when the constructed class is runed's `Context`.
 *
 * Why: a module-scope class instance is created once per server process and
 * shared by every SSR request. Any `$state` it holds leaks between users
 * (#500). The sanctioned pattern is a module-scope `Context` definition whose
 * instance is created and `set()` inside a layout/component, so each request
 * tree gets its own state.
 *
 * ❌ export const manager = new ChatManager();
 * ✅ export const chatContext = new Context<ChatManager>('chat');   // set in a layout
 * ✅ // eslint-disable-next-line local/no-module-state-singleton -- browser-only writes, nothing rendered into SSR HTML
 *    export const haptic = new UseHaptic();
 */
export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow module-scope class instances in .svelte.ts files (cross-request SSR state leak)'
		},
		schema: [],
		messages: {
			moduleStateSingleton:
				'Module-scope class instance is shared across SSR requests; any $state it holds leaks between users. Create the instance in a layout/component and share it via runed Context (export const fooContext = new Context<T>(...); fooContext.set(...) in the component).'
		}
	},
	create(context) {
		return {
			// ExportNamedDeclaration only occurs at module top level, so this
			// matches exactly the top-level exported singletons without needing
			// parent traversal.
			ExportNamedDeclaration(node) {
				const declaration = node.declaration;
				if (!declaration || declaration.type !== 'VariableDeclaration') return;

				for (const declarator of declaration.declarations) {
					const init = declarator.init;
					if (!init || init.type !== 'NewExpression') continue;

					// runed's Context is the sanctioned per-request sharing pattern.
					if (init.callee?.type === 'Identifier' && init.callee.name === 'Context') continue;

					context.report({ node: declarator, messageId: 'moduleStateSingleton' });
				}
			}
		};
	}
};
