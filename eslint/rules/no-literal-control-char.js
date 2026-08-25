/**
 * ESLint rule: no-literal-control-char
 *
 * Flags a control or bidirectional-formatting character written as the character
 * itself instead of an escape.
 *
 * Why: the character is often the right one. NUL is a good separator for a
 * composite key, because it cannot occur in the parts being joined. Writing it as
 * the raw byte is what breaks. It renders as nothing, so a reader sees an empty
 * string where the code means a separator, and a text search or scripted edit
 * matches nothing while appearing to succeed. A NUL goes further and takes the
 * file out of code review altogether, because git classifies a file holding one as
 * binary and stops diffing it. The other characters here keep their text diffs and
 * simply show nothing in them.
 *
 * The bidirectional characters are worse than invisible: they reorder how the
 * source displays without changing what it does, so a reviewer can read one
 * program while the compiler reads another (Trojan Source, CVE-2021-42574).
 *
 * A source-text scan reaches string literals, template literals, comments, JSX
 * text and identifiers. The categories are a closed set, so anything outside it
 * passes without guesswork.
 *
 * The report names the codepoint and never quotes the offending source. Printing
 * the line would show the reader nothing, and an escape sequence pasted into a
 * terminal reprograms it.
 *
 * The example is described instead of written out. Spelling the byte here would
 * put the character this rule bans into the rule that bans it. The first run over
 * the repository found exactly that in this file.
 *
 * Bad: a raw 0x01 byte between two interpolations, showing as nothing at all.
 * Good: the same separator written as the six characters of a unicode escape.
 */

import { findLiteralControlCharacters } from '../control-character-policy.js';

const MESSAGE =
	'{{codepoint}} ({{category}}) is written as the character itself, so it is invisible in editors, diffs and text search. Remove it or replace it with visible whitespace. If it belongs inside a string or template literal, write {{escape}}.';

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow control and bidirectional-formatting characters written as the character itself'
		},
		schema: [],
		messages: {
			literalControlChar: MESSAGE
		}
	},
	create(context) {
		return {
			Program() {
				for (const finding of findLiteralControlCharacters(context.sourceCode.getText())) {
					context.report({
						loc: { line: finding.line, column: finding.column },
						messageId: 'literalControlChar',
						data: finding.data
					});
				}
			}
		};
	}
};
