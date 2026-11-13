/**
 * ESLint rule: no-middle-dot-or-em-dash
 *
 * Flags a middle dot (U+00B7) or em dash (U+2014) in text the application ships:
 * string literals, template literal parts, and Svelte text and attribute values.
 * Comments are not shipped and stay out of scope, and so is a Svelte `<style>`
 * block, whose text is CSS.
 *
 * The check reads the value, not the source, so an escape such as `'\u00b7'` is
 * reported too: it ships the same character. Regular expressions are code, not
 * text, so a pattern that finds or strips the characters passes.
 *
 * Data that has to mirror third-party or recorded content, such as a fixture
 * copied from a provider response, keeps the character behind an
 * `eslint-disable-next-line` comment that names the reason.
 *
 * Bad:  `Plan · ${price}`, <span>Draft — ready</span>
 * Good: a gap between two spans, `Draft: ready`, or a line break
 */

const BANNED = /[\u00B7\u2014]/u;

const MESSAGE =
	'Shipped text never contains a middle dot or em dash: use a comma, colon, line break or spacing. Data that mirrors third-party or recorded content takes an eslint-disable comment with the reason.';

export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow a middle dot or em dash in shipped text'
		},
		schema: [],
		messages: {
			middleDotOrEmDash: MESSAGE
		}
	},
	create(context) {
		function check(node, text) {
			if (typeof text === 'string' && BANNED.test(text)) {
				context.report({ node, messageId: 'middleDotOrEmDash' });
			}
		}
		return {
			Literal(node) {
				check(node, node.value);
			},
			TemplateElement(node) {
				check(node, node.value.cooked ?? node.value.raw);
			},
			SvelteText(node) {
				if (node.parent?.type !== 'SvelteStyleElement') check(node, node.value);
			},
			SvelteLiteral(node) {
				check(node, node.value);
			}
		};
	}
};
