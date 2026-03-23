/**
 * ESLint rule: no-hardcoded-aria-label
 *
 * Flags aria-label attributes with hardcoded string values in Svelte templates.
 * All aria-label values must be localized via $t() calls.
 *
 * ✅ aria-label={$t('aria.close')}
 * ✅ aria-label={someVariable}       (variable may come from $t() upstream — not our call)
 * ❌ aria-label="Close"
 * ❌ aria-label="Close {name}"
 * ❌ aria-label={'Close'}            (string literal inside expression)
 */
export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow hardcoded strings in aria-label attributes (must use $t())'
		},
		schema: [],
		messages: {
			hardcodedAriaLabel:
				"aria-label contains a hardcoded string. Use $t() for localization: aria-label={$t('aria.key')}"
		}
	},
	create(context) {
		return {
			SvelteAttribute(node) {
				// Only check aria-label attributes
				if (node.key?.name !== 'aria-label') return;

				// No value means boolean attribute (aria-label without value) — unusual but not our concern
				if (!node.value || node.value.length === 0) return;

				// If every value part is a SvelteMustacheTag wrapping a $t() call, it's fine
				const allLocalized = node.value.every(
					(v) =>
						v.type === 'SvelteMustacheTag' &&
						v.expression?.type === 'CallExpression' &&
						v.expression.callee?.type === 'Identifier' &&
						v.expression.callee.name === '$t'
				);

				if (allLocalized) return;

				// Flag if any value part contains a hardcoded string:
				// - SvelteLiteral: aria-label="Close" or aria-label="Close {name}"
				// - SvelteMustacheTag with a Literal expression: aria-label={'Close'}
				const hasHardcodedString = node.value.some(
					(v) =>
						v.type === 'SvelteLiteral' ||
						(v.type === 'SvelteMustacheTag' &&
							v.expression?.type === 'Literal' &&
							typeof v.expression.value === 'string')
				);
				if (hasHardcodedString) {
					context.report({ node, messageId: 'hardcodedAriaLabel' });
				}
			}
		};
	}
};
