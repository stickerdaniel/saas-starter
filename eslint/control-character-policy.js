/**
 * The closed set of characters this repository refuses to store as raw bytes,
 * and the two operations every consumer of that set needs.
 *
 * Three consumers share it and must not drift apart: the `no-literal-control-char`
 * ESLint rule, the Svelte parser wrapper that sanitizes a fatal parser message, and
 * the source-safety preflight in `scripts/static-checks.ts`. A second copy of the
 * ranges is how one of them ends up accepting a character the others reject.
 *
 * The set is spelled out rather than derived from Unicode properties, so widening
 * it is a visible edit in review and a Unicode revision cannot do it silently.
 */

// Tab, line feed and carriage return are what source is made of. Flagging them
// would flag every file, and a check that noisy gets switched off the same day.
const STRUCTURAL = new Set([0x09, 0x0a, 0x0d]);

/** @typedef {'C0 control' | 'DEL' | 'C1 control' | 'bidirectional formatting' | 'line separator'} CharacterCategory */
/** @typedef {{ codepoint: string, category: CharacterCategory, escape: string }} CharacterData */
/** @typedef {{ line: number, column: number, data: CharacterData }} SourceFinding */

// Every character Unicode gives the Bidi_Control property: the marks (U+061C,
// U+200E, U+200F) set a run's direction, the embeddings and overrides
// (U+202A-U+202E) and the isolates (U+2066-U+2069) reorder it.
const BIDI = new Set([
	0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069
]);

/** @param {number} code @returns {CharacterCategory | null} */
function baseCategory(code) {
	if (code < 0x20) return 'C0 control';
	if (code === 0x7f) return 'DEL';
	if (code >= 0x80 && code <= 0x9f) return 'C1 control';
	return BIDI.has(code) ? 'bidirectional formatting' : null;
}

/** The category a banned source codepoint belongs to, or null when it is legal. */
/** @param {number} code @returns {CharacterCategory | null} */
export function category(code) {
	return STRUCTURAL.has(code) ? null : baseCategory(code);
}

/**
 * A diagnostic field cannot treat source structure as structure of its own.
 * Newline, carriage return and tab are legal between source tokens; inside a path
 * they split, overwrite or indent the terminal diagnostic that names that path.
 * JavaScript's two Unicode line separators have the same problem there.
 */
/** @param {number} code @returns {CharacterCategory | null} */
export function diagnosticCategory(code) {
	if (code === 0x2028 || code === 0x2029) return 'line separator';
	return baseCategory(code);
}

/** The three ways a finding names its character, none of which is the character. */
/** @param {number} code @param {CharacterCategory} kind @returns {CharacterData} */
export function dataFor(code, kind) {
	const hex = code.toString(16).padStart(4, '0').toUpperCase();
	return { codepoint: `U+${hex}`, category: kind, escape: `\\u${hex}` };
}

/**
 * Incremental source scanner. The deferred CR keeps CRLF correct when a stream splits
 * the pair across chunks; columns remain UTF-16 code units, which is ESLint's model.
 */
/** @param {(finding: SourceFinding) => void} onFinding */
export function createLiteralControlCharacterScanner(onFinding) {
	let line = 1;
	let column = 0;
	let pendingCarriageReturn = false;

	return {
		/** @param {string} text */
		write(text) {
			for (let index = 0; index < text.length; index++) {
				const code = text.charCodeAt(index);
				if (pendingCarriageReturn) {
					line++;
					column = 0;
					pendingCarriageReturn = false;
					if (code === 0x0a) continue;
				}
				if (code === 0x0d) {
					pendingCarriageReturn = true;
					continue;
				}
				if (code === 0x0a || code === 0x2028 || code === 0x2029) {
					line++;
					column = 0;
					continue;
				}
				const kind = category(code);
				if (kind !== null) onFinding({ line, column, data: dataFor(code, kind) });
				column++;
			}
		},
		end() {
			if (!pendingCarriageReturn) return;
			line++;
			column = 0;
			pendingCarriageReturn = false;
		}
	};
}

/** Every banned character and its ESLint location in the supplied source. */
/** @param {string} text @returns {SourceFinding[]} */
export function findLiteralControlCharacters(text) {
	/** @type {SourceFinding[]} */
	const findings = [];
	const scanner = createLiteralControlCharacterScanner((finding) => findings.push(finding));
	scanner.write(text);
	scanner.end();
	return findings;
}

/** Every character that is unsafe inside one diagnostic field. */
/** @param {string} text @returns {{ index: number, data: CharacterData }[]} */
export function findDiagnosticControlCharacters(text) {
	/** @type {{ index: number, data: CharacterData }[]} */
	const findings = [];
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		const kind = diagnosticCategory(code);
		if (kind !== null) findings.push({ index, data: dataFor(code, kind) });
	}
	return findings;
}

/** Make one filename, token or source excerpt safe to place on a terminal line. */
/** @param {string} text @returns {string} */
export function sanitizeDiagnosticField(text) {
	let safe = '';
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		const kind = diagnosticCategory(code);
		safe += kind === null ? text[index] : dataFor(code, kind).codepoint;
	}
	return safe;
}

/** Remove banned characters from diagnostic prose before a formatter sees it. */
/** @param {string} text @returns {string} */
export function sanitizeDiagnosticText(text) {
	let safe = '';
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		const kind = category(code);
		safe += kind === null ? text[index] : dataFor(code, kind).codepoint;
	}
	return safe;
}
