import path from 'node:path';

export interface FrontmatterError {
	line: number;
	message: string;
}

export interface FrontmatterField {
	value: string;
	line: number;
}

export interface FrontmatterParseResult {
	present: boolean;
	fields: Readonly<Record<string, FrontmatterField>>;
	errors: readonly FrontmatterError[];
}

export interface MarkdownLink {
	target: string;
	line: number;
}

export interface ResolvedMarkdownLink {
	target: string;
	outsideRepository: boolean;
}

function unquoteScalar(value: string): string | null {
	if (value.length < 2) return value;
	const first = value[0];
	const last = value.at(-1);
	if ((first === '"' || first === "'") && first === last) return value.slice(1, -1);
	if (first === '"' || first === "'" || last === '"' || last === "'") return null;
	return value;
}

export function parseFlatFrontmatter(text: string): FrontmatterParseResult {
	const lines = text.replaceAll('\r\n', '\n').split('\n');
	if (lines[0] !== '---') return { present: false, fields: {}, errors: [] };

	const fields: Record<string, FrontmatterField> = {};
	const errors: FrontmatterError[] = [];
	let closed = false;

	for (let index = 1; index < lines.length; index += 1) {
		const line = lines[index]!;
		const lineNumber = index + 1;
		if (line === '---') {
			closed = true;
			break;
		}
		if (!line.trim()) continue;
		if (/^\s/.test(line) || /^[-?]\s/.test(line) || /:\s*[>|]\s*$/.test(line)) {
			errors.push({ line: lineNumber, message: 'Frontmatter supports flat scalar fields only.' });
			continue;
		}

		const separator = line.indexOf(':');
		if (separator < 1) {
			errors.push({ line: lineNumber, message: 'Expected a "key: value" frontmatter field.' });
			continue;
		}
		const key = line.slice(0, separator).trim();
		const rawValue = line.slice(separator + 1).trim();
		if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) {
			errors.push({ line: lineNumber, message: `Invalid frontmatter key "${key}".` });
			continue;
		}
		if (Object.hasOwn(fields, key)) {
			errors.push({ line: lineNumber, message: `Duplicate frontmatter key "${key}".` });
			continue;
		}
		if (
			rawValue.startsWith('[') ||
			rawValue.startsWith('{') ||
			rawValue.endsWith(']') ||
			rawValue.endsWith('}')
		) {
			errors.push({
				line: lineNumber,
				message: 'Frontmatter arrays and objects are not supported.'
			});
			continue;
		}
		const value = unquoteScalar(rawValue);
		if (value === null) {
			errors.push({ line: lineNumber, message: `Mismatched quotes for frontmatter key "${key}".` });
			continue;
		}
		fields[key] = { value, line: lineNumber };
	}

	if (!closed) errors.push({ line: 1, message: 'Frontmatter is missing its closing delimiter.' });
	return { present: true, fields, errors };
}

function isEscaped(text: string, index: number): boolean {
	let slashes = 0;
	for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) slashes += 1;
	return slashes % 2 === 1;
}

function maskInlineCode(line: string): string {
	const chars = [...line];
	let cursor = 0;
	while (cursor < chars.length) {
		if (chars[cursor] !== '`' || isEscaped(line, cursor)) {
			cursor += 1;
			continue;
		}
		let run = 1;
		while (chars[cursor + run] === '`') run += 1;
		const marker = '`'.repeat(run);
		const end = line.indexOf(marker, cursor + run);
		if (end < 0) break;
		for (let index = cursor; index < end + run; index += 1) chars[index] = ' ';
		cursor = end + run;
	}
	return chars.join('');
}

function activeMarkdownLines(text: string): Array<{ text: string; line: number }> {
	const lines = text.replaceAll('\r\n', '\n').split('\n');
	const active: Array<{ text: string; line: number }> = [];
	let fence: { marker: string; length: number } | null = null;

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index]!;
		const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
		if (fenceMatch) {
			const run = fenceMatch[1]!;
			const marker = run[0]!;
			if (!fence) fence = { marker, length: run.length };
			else if (marker === fence.marker && run.length >= fence.length) fence = null;
			continue;
		}
		if (!fence) active.push({ text: maskInlineCode(line), line: index + 1 });
	}
	return active;
}

function normalizeReferenceLabel(label: string): string {
	return label
		.replace(/\\([\\[\]])/g, '$1')
		.trim()
		.replace(/\s+/g, ' ')
		.toLowerCase();
}

function findClosingBracket(line: string, start: number): number {
	for (let index = start + 1; index < line.length; index += 1) {
		if (line[index] === ']' && !isEscaped(line, index)) return index;
	}
	return -1;
}

function findClosingParenthesis(line: string, start: number): number {
	let depth = 0;
	let inAngle = false;
	let quote: '"' | "'" | null = null;
	for (let index = start + 1; index < line.length; index += 1) {
		const char = line[index]!;
		if (isEscaped(line, index)) continue;
		if (quote) {
			if (char === quote) quote = null;
			continue;
		}
		if (inAngle) {
			if (char === '>') inAngle = false;
			continue;
		}
		if (char === '<') {
			inAngle = true;
			continue;
		}
		if ((char === '"' || char === "'") && depth === 0) {
			quote = char;
			continue;
		}
		if (char === '(') depth += 1;
		else if (char === ')' && depth === 0) return index;
		else if (char === ')') depth -= 1;
	}
	return -1;
}

function inlineDestination(contents: string): string | null {
	const trimmed = contents.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith('<')) {
		const end = trimmed.indexOf('>');
		return end > 0 ? trimmed.slice(1, end) : null;
	}

	let depth = 0;
	for (let index = 0; index < trimmed.length; index += 1) {
		const char = trimmed[index]!;
		if (isEscaped(trimmed, index)) continue;
		if (char === '(') depth += 1;
		else if (char === ')') depth = Math.max(0, depth - 1);
		else if (/\s/.test(char) && depth === 0) return trimmed.slice(0, index);
	}
	return trimmed;
}

export function extractMarkdownLinks(text: string): MarkdownLink[] {
	const active = activeMarkdownLines(text);
	const references = new Map<string, string>();
	const definitionLines = new Set<number>();

	for (const entry of active) {
		const match = entry.text.match(
			/^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|((?:\\.|[^\s])+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/
		);
		if (!match) continue;
		references.set(normalizeReferenceLabel(match[1]!), match[2] ?? match[3]!);
		definitionLines.add(entry.line);
	}

	const links: MarkdownLink[] = [];
	for (const entry of active) {
		if (definitionLines.has(entry.line)) continue;
		const line = entry.text;
		for (let cursor = 0; cursor < line.length; cursor += 1) {
			if (line[cursor] !== '[' || isEscaped(line, cursor)) continue;
			const close = findClosingBracket(line, cursor);
			if (close < 0) continue;
			const label = line.slice(cursor + 1, close);
			const next = line[close + 1];

			if (next === '(') {
				const end = findClosingParenthesis(line, close + 1);
				if (end < 0) continue;
				const target = inlineDestination(line.slice(close + 2, end));
				if (target) links.push({ target, line: entry.line });
				cursor = end;
				continue;
			}

			if (next === '[') {
				const referenceEnd = findClosingBracket(line, close + 1);
				if (referenceEnd < 0) continue;
				const reference = line.slice(close + 2, referenceEnd) || label;
				const target = references.get(normalizeReferenceLabel(reference));
				if (target) links.push({ target, line: entry.line });
				cursor = referenceEnd;
				continue;
			}

			const shortcut = references.get(normalizeReferenceLabel(label));
			if (shortcut) links.push({ target: shortcut, line: entry.line });
			cursor = close;
		}
	}
	return links;
}

export function resolveRelativeLink(
	sourceFile: string,
	link: MarkdownLink
): ResolvedMarkdownLink | null {
	const raw = link.target.trim().replace(/^<|>$/g, '');
	if (
		!raw ||
		raw.startsWith('#') ||
		raw.startsWith('/') ||
		raw.startsWith('//') ||
		/^[a-z][a-z0-9+.-]*:/i.test(raw)
	) {
		return null;
	}
	const pathOnly = raw.split(/[?#]/, 1)[0];
	if (!pathOnly) return null;
	let decoded = pathOnly;
	try {
		decoded = decodeURI(pathOnly);
	} catch {
		// Keep the literal target. Existence checking will report it if necessary.
	}
	const target = path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile), decoded));
	return {
		target,
		outsideRepository: target === '..' || target.startsWith('../') || path.posix.isAbsolute(target)
	};
}
