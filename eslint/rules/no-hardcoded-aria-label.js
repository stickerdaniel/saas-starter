/**
 * ESLint rule: no-hardcoded-aria-label
 *
 * Flags aria-label attributes with hardcoded string values in Svelte templates.
 * All aria-label values must be localized via $t() calls.
 *
 * ✅ aria-label={$t('aria.close')}
 * ❌ aria-label="Close"
 * ❌ aria-label="Close {name}"
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

				// If any value part is a SvelteLiteral (hardcoded string), flag it
				const hasLiteral = node.value.some((v) => v.type === 'SvelteLiteral');
				if (hasLiteral) {
					context.report({ node, messageId: 'hardcodedAriaLabel' });
				}
			}
		};
	}
};
