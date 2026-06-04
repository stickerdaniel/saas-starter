/**
 * ESLint rule: no-hardcoded-modifier-keys
 *
 * Flags hardcoded macOS modifier symbols (⌘, ⌃, ⌥) in Svelte templates and
 * string literals. Platform-specific modifier labels must come from
 * $lib/hooks/is-mac.svelte (cmdOrCtrl, ctrlSymbol, optionOrAlt) so
 * Windows/Linux users see the right modifier.
 *
 * ✅ <DropdownMenu.Shortcut>{cmdOrCtrl}K</DropdownMenu.Shortcut>
 * ✅ kbd: [ctrlSymbol, '⇧', '1']        (⇧ is used cross-platform on purpose)
 * ❌ <DropdownMenu.Shortcut>⌘K</DropdownMenu.Shortcut>
 * ❌ const shortcut = '⌘K';
 *
 * Comments are not AST nodes, so JSDoc/inline comments mentioning ⌘ are fine.
 */
const MODIFIER_SYMBOLS = /[⌘⌃⌥]/u; // ⌘ ⌃ ⌥

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow hardcoded macOS modifier symbols (use cmdOrCtrl/ctrlSymbol/optionOrAlt from $lib/hooks/is-mac.svelte)'
		},
		schema: [],
		messages: {
			hardcodedModifier:
				'Hardcoded macOS modifier symbol. Use cmdOrCtrl / ctrlSymbol / optionOrAlt from $lib/hooks/is-mac.svelte so non-mac users see the right modifier.'
		}
	},
	create(context) {
		function check(node, text) {
			if (typeof text === 'string' && MODIFIER_SYMBOLS.test(text)) {
				context.report({ node, messageId: 'hardcodedModifier' });
			}
		}

		return {
			// Script string literals: const k = '⌘K'
			Literal(node) {
				check(node, node.value);
			},
			// Template literals: `Press ⌘K`
			TemplateElement(node) {
				check(node, node.value?.raw);
			},
			// Svelte template text: <span>⌘K</span>
			SvelteText(node) {
				check(node, node.value);
			},
			// Svelte attribute string parts: <Kbd label="⌘K" />
			SvelteLiteral(node) {
				check(node, node.value);
			}
		};
	}
};
