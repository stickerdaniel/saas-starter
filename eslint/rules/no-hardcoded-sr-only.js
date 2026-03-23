/**
 * ESLint rule: no-hardcoded-sr-only
 *
 * Flags .sr-only elements that contain hardcoded text instead of $t() calls.
 * All screen-reader-only text must be localized.
 *
 * ✅ <span class="sr-only">{$t('aria.copy')}</span>
 * ❌ <span class="sr-only">Copy</span>
 */
export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow hardcoded text in .sr-only elements (must use $t())'
		},
		schema: [],
		messages: {
			hardcodedSrOnly:
				"sr-only element contains hardcoded text. Use $t() for localization: {$t('aria.key')}"
		}
	},
	create(context) {
		return {
			SvelteElement(node) {
				if (!hasSrOnlyClass(node)) return;

				// Check children for hardcoded text
				const hasHardcodedText = node.children.some(
					(child) => child.type === 'SvelteText' && child.value.trim() !== ''
				);

				if (hasHardcodedText) {
					context.report({ node: node.startTag, messageId: 'hardcodedSrOnly' });
				}
			}
		};
	}
};

/**
 * Check if a SvelteElement has the sr-only class.
 * Handles: class="sr-only", class="foo sr-only bar"
 */
function hasSrOnlyClass(node) {
	const startTag = node.startTag;
	if (!startTag?.attributes) return false;

	for (const attr of startTag.attributes) {
		if (attr.type !== 'SvelteAttribute' || attr.key?.name !== 'class') continue;

		// Static class value: class="sr-only" or class="foo sr-only"
		for (const valuePart of attr.value || []) {
			if (valuePart.type === 'SvelteLiteral' && hasSrOnlyToken(valuePart.value)) {
				return true;
			}
		}
	}

	return false;
}

function hasSrOnlyToken(classString) {
	return classString.split(/\s+/).includes('sr-only');
}
