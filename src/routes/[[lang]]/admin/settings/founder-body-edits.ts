import {
	isAllowedHref,
	listMarker,
	markupSpans,
	type FounderTemplateVariables
} from '#lib/convex/emails/founderTemplate.js';

/**
 * Formatting commands for the founder body editor. Each reads the body and its
 * selection and returns the replacement to apply, or nothing when the command
 * would produce markup the renderer does not read, such as bold inside a link.
 */

/** The body and its selected range. */
export type BodySelection = { value: string; start: number; end: number };

/** Replace `from..to` with `text`, then select `select`. */
export type BodyEdit = { from: number; to: number; text: string; select: [number, number] };

/** The `{{name}}` syntax `renderFounderTemplate` resolves. */
const PLACEHOLDER = /\{\{\w+\}\}/g;

type LineSelection = { offset: number; line: string; from: number; to: number };

/** The selection within its line, or nothing when it spans lines. */
function lineSelection({ value, start, end }: BodySelection): LineSelection | undefined {
	const offset = value.lastIndexOf('\n', start - 1) + 1;
	const lineEnd = value.indexOf('\n', start);
	if (lineEnd !== -1 && end > lineEnd) return undefined;
	const line = value.slice(offset, lineEnd === -1 ? undefined : lineEnd);
	return { offset, line, from: start - offset, to: end - offset };
}

/** The selection without surrounding whitespace, so `word ` wraps as `word`. */
function trimmed(selection: LineSelection): LineSelection {
	let { from, to } = selection;
	while (from < to && /\s/.test(selection.line[from] ?? '')) from++;
	while (to > from && /\s/.test(selection.line[to - 1] ?? '')) to--;
	return { ...selection, from, to };
}

/**
 * Whether new markup fits at the selection: past the list marker, overlapping no
 * markup token, and cutting through no placeholder. A caret on a token's edge is
 * outside it.
 */
function isFree({ line, from, to }: LineSelection): boolean {
	if (from < (listMarker(line)?.length ?? 0)) return false;
	const touches = (start: number, end: number) =>
		from === to ? start < from && from < end : start < to && from < end;
	if (markupSpans(line).some((span) => touches(span.start, span.end))) return false;
	return [...line.matchAll(PLACEHOLDER)].every(({ index, 0: token }) => {
		const end = index + token.length;
		return !touches(index, end) || (from <= index && end <= to);
	});
}

/** The bold or link span around the selection, when it lies inside one. */
function enclosingSpan({ line, from, to }: LineSelection, kind: 'bold' | 'link') {
	return markupSpans(line).find(
		(span) =>
			span.kind === kind &&
			(from === to ? span.start < from && from < span.end : span.start <= from && to <= span.end)
	);
}

/** Replace the line range `from..to` and select `select` within the line. */
function lineEdit(
	{ offset }: LineSelection,
	from: number,
	to: number,
	text: string,
	select: [number, number]
): BodyEdit {
	return {
		from: offset + from,
		to: offset + to,
		text,
		select: [offset + select[0], offset + select[1]]
	};
}

/** Bold the selection, or remove the bold span the selection lies in. */
export function toggleBold(selection: BodySelection): BodyEdit | undefined {
	const line = lineSelection(selection);
	if (!line) return undefined;
	const bold = enclosingSpan(line, 'bold');
	if (bold?.kind === 'bold') {
		return lineEdit(line, bold.start, bold.end, bold.text, [
			bold.start,
			bold.start + bold.text.length
		]);
	}
	const target = trimmed(line);
	const text = target.line.slice(target.from, target.to);
	if (text.includes('*') || !isFree(target)) return undefined;
	return lineEdit(target, target.from, target.to, `**${text}**`, [target.from + 2, target.to + 2]);
}

/**
 * Link the selection with an empty `https://` target selected for the URL, or
 * remove the link the selection lies in and keep its label.
 */
export function toggleLink(selection: BodySelection): BodyEdit | undefined {
	const line = lineSelection(selection);
	if (!line) return undefined;
	const link = enclosingSpan(line, 'link');
	if (link?.kind === 'link') {
		return lineEdit(line, link.start, link.end, link.label, [
			link.start,
			link.start + link.label.length
		]);
	}
	const target = trimmed(line);
	const label = target.line.slice(target.from, target.to);
	if (/[[\]]/.test(label) || !isFree(target)) return undefined;
	const urlStart = target.from + label.length + 3;
	return lineEdit(
		target,
		target.from,
		target.to,
		`[${label}](https://)`,
		label ? [urlStart, urlStart + 'https://'.length] : [target.from + 1, target.from + 1]
	);
}

/** Link the selection to a pasted URL when the result renders as a link. */
export function pasteLink(selection: BodySelection, pasted: string): BodyEdit | undefined {
	const url = pasted.trim();
	const line = lineSelection(selection);
	// The renderer's link token admits no parentheses in the URL.
	if (!line || /[()]/.test(url) || !isAllowedHref(url)) return undefined;
	const label = line.line.slice(line.from, line.to);
	if (!label.trim() || /[[\]]/.test(label) || !isFree(line)) return undefined;
	const end = line.from + label.length + url.length + 4;
	return lineEdit(line, line.from, line.to, `[${label}](${url})`, [end, end]);
}

/**
 * Make the selected lines a bulleted or numbered list, or plain lines again when
 * they already are one. Blank lines stay blank and numbering skips them.
 */
export function toggleList(selection: BodySelection, ordered: boolean): BodyEdit {
	const { value, start, end } = selection;
	const from = value.lastIndexOf('\n', start - 1) + 1;
	const lineEnd = value.indexOf('\n', end);
	const to = lineEnd === -1 ? value.length : lineEnd;
	const lines = value.slice(from, to).split('\n');
	const items = lines.filter((line) => line.trim());
	const isList = items.every((line) => listMarker(line)?.ordered === ordered);
	let number = 0;
	const text = lines
		.map((line) => {
			if (!line.trim()) return line;
			const content = line.slice(listMarker(line)?.length ?? 0);
			if (isList) return content;
			number += 1;
			return `${ordered ? `${number}.` : '-'} ${content}`;
		})
		.join('\n');
	const select: [number, number] =
		start === end ? [from + text.length, from + text.length] : [from, from + text.length];
	return { from, to, text, select };
}

/** Insert a `{{name}}` placeholder in place of the selection. */
export function insertVariable(
	{ start, end }: BodySelection,
	name: keyof FounderTemplateVariables
): BodyEdit {
	const text = `{{${name}}}`;
	return { from: start, to: end, text, select: [start + text.length, start + text.length] };
}
