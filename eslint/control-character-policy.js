/**
 * One closed character policy for source lint and terminal diagnostics.
 *
 * Source structure may contain tab, LF, and CR. A terminal field may not: those
 * characters can indent, split, or overwrite the diagnostic that contains it. A
 * complete output stream keeps tab and LF for layout and handles CRLF separately.
 */

const SOURCE_STRUCTURE = new Set([0x09, 0x0a, 0x0d]);
const OUTPUT_STRUCTURE = new Set([0x09, 0x0a]);
const BIDI = new Set([
	0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069
]);

/** @typedef {'C0 control' | 'DEL' | 'C1 control' | 'bidirectional formatting' | 'line separator'} CharacterCategory */
/** @typedef {{ codepoint: string, category: CharacterCategory, escape: string }} CharacterData */
/** @typedef {{ line: number, column: number, data: CharacterData }} SourceFinding */

/** @param {number} code @returns {CharacterCategory | null} */
function baseCategory(code) {
	if (code < 0x20) return 'C0 control';
	if (code === 0x7f) return 'DEL';
	if (code >= 0x80 && code <= 0x9f) return 'C1 control';
	return BIDI.has(code) ? 'bidirectional formatting' : null;
}

/** @param {number} code @returns {CharacterCategory | null} */
export function sourceCategory(code) {
	return SOURCE_STRUCTURE.has(code) ? null : baseCategory(code);
}

/** @param {number} code @returns {CharacterCategory | null} */
export function terminalCategory(code) {
	if (code === 0x2028 || code === 0x2029) return 'line separator';
	return OUTPUT_STRUCTURE.has(code) ? null : baseCategory(code);
}

/** @param {number} code @returns {CharacterCategory | null} */
function fieldCategory(code) {
	if (code === 0x2028 || code === 0x2029) return 'line separator';
	return baseCategory(code);
}

/** @param {number} code @param {CharacterCategory} kind @returns {CharacterData} */
export function dataFor(code, kind) {
	const hex = code.toString(16).padStart(4, '0').toUpperCase();
	return { codepoint: `U+${hex}`, category: kind, escape: `\\u${hex}` };
}

/** @param {string} text @returns {SourceFinding[]} */
export function findLiteralControlCharacters(text) {
	/** @type {SourceFinding[]} */
	const findings = [];
	let line = 1;
	let column = 0;
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		if (code === 0x0d) {
			if (text.charCodeAt(index + 1) !== 0x0a) {
				line++;
				column = 0;
			}
			continue;
		}
		if (code === 0x0a || code === 0x2028 || code === 0x2029) {
			line++;
			column = 0;
			continue;
		}
		const kind = sourceCategory(code);
		if (kind !== null) findings.push({ line, column, data: dataFor(code, kind) });
		column++;
	}
	return findings;
}

/** Preserve source structure while neutralizing a parser message. @param {string} text */
export function sanitizeDiagnosticText(text) {
	let safe = '';
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		const kind = sourceCategory(code);
		safe += kind === null ? text[index] : dataFor(code, kind).codepoint;
	}
	return safe;
}

/** Neutralize one filename, token, argument, or source excerpt. @param {string} text */
export function sanitizeTerminalField(text) {
	let safe = '';
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		const kind = fieldCategory(code);
		safe += kind === null ? text[index] : dataFor(code, kind).codepoint;
	}
	return safe;
}
