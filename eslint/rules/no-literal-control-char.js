/**
 * ESLint rule: no-literal-control-char
 *
 * Flags a control or bidirectional-formatting character written as the character
 * itself instead of an escape.
 *
 * Why: the character is often the right one. NUL is a good separator for a
 * composite key, because it cannot occur in the parts being joined. Writing it as
 * the raw byte is what breaks. It renders as nothing, so a reader sees an empty
 * string where the code means a separator, a text search or scripted edit matches
 * nothing while appearing to succeed, and git calls the whole file binary, which
 * takes its diffs out of code review.
 *
 * The bidirectional characters are worse than invisible: they reorder how the
 * source displays without changing what it does, so a reviewer can read one
 * program while the compiler reads another (Trojan Source, CVE-2021-42574).
 *
 * A scan over the source text rather than an AST visit, because these characters
 * hide anywhere: string literals, template literals, comments, JSX text, and
 * identifiers. The categories are a closed set, so anything outside it passes
 * rather than being guessed at.
 *
 * The report names the codepoint and never quotes the offending source. Printing
 * the line would show the reader nothing, and an escape sequence pasted into a
 * terminal reprograms it.
 *
 * The example is described rather than written out, because spelling the byte here
 * would put the character this rule bans into the rule that bans it. That is not
 * hypothetical: the first run of this rule over the repository flagged this file.
 *
 * ❌ a raw 0x01 byte between two interpolations, showing as nothing at all
 * ✅ the same separator written as the six characters of a unicode escape
 */

// Tab, line feed and carriage return are what source is made of. Flagging them
// would flag every file, and a check that noisy gets switched off the same day.
const STRUCTURAL = new Set([0x09, 0x0a, 0x0d]);

// Bidirectional formatting characters. The embedding and override pair
// (U+202A-U+202E) and the isolates (U+2066-U+2069) reorder a run of text; the
// marks (U+200E, U+200F) set its direction.
const BIDI = new Set([
	0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069
]);

/** The category a banned codepoint belongs to, or null when it is legal. */
function category(code) {
	if (STRUCTURAL.has(code)) return null;
	if (code < 0x20) return 'C0 control';
	if (code === 0x7f) return 'DEL';
	if (code >= 0x80 && code <= 0x9f) return 'C1 control';
	return BIDI.has(code) ? 'bidirectional formatting' : null;
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow control and bidirectional-formatting characters written as the character itself'
		},
		schema: [],
		messages: {
			literalControlChar:
				'{{codepoint}} ({{category}}) is written as the character itself, so it is invisible in editors, diffs and text search, and it makes git treat this file as binary. Write it as an escape ({{escape}}).'
		}
	},
	create(context) {
		return {
			Program() {
				const text = context.sourceCode.getText();
				let line = 1;
				let column = 0;
				for (let i = 0; i < text.length; i++) {
					const code = text.charCodeAt(i);
					if (code === 0x0a) {
						line++;
						column = 0;
						continue;
					}
					const kind = category(code);
					if (kind !== null) {
						const hex = code.toString(16).padStart(4, '0').toUpperCase();
						context.report({
							loc: { line, column },
							messageId: 'literalControlChar',
							data: { codepoint: `U+${hex}`, category: kind, escape: `\\u${hex}` }
						});
					}
					column++;
				}
			}
		};
	}
};
