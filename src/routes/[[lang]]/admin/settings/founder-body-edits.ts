import {
	isAllowedHref,
	listMarker,
	markupSpans,
	type FounderTemplateVariables,
	type ListMarker
} from '#lib/convex/emails/founderTemplate.js';

/**
 * Formatting commands for the founder body editor. Each reads the body and its
 * selection and returns the replacement to apply, or nothing when the command
 * would produce markup the renderer does not read, such as bold inside a link.
 * `bodyFormats` reports what the toolbar shows as on from the same checks, so an
 * active toggle always removes its format.
 */

/** The body and its selected range. */
export type BodySelection = { value: string; start: number; end: number };

/** Replace `from..to` with `text`, then select `select`. */
export type BodyEdit = { from: number; to: number; text: string; select: [number, number] };

export type ListKind = 'bulleted' | 'numbered';

/** The formats at a selection, as the toolbar toggles show them. */
export type BodyFormats = { bold: boolean; link: boolean; list: ListKind | undefined };

/** The `{{name}}` syntax `renderFounderTemplate` resolves. */
const PLACEHOLDER = /\{\{\w+\}\}/g;

// A list marker the editor inserted before its text, which the renderer reads
// only once the text follows.
const BARE_MARKER = /^(?:-|(\d{1,9})\.)[ \t]+$/;

type LineSelection = { offset: number; line: string; from: number; to: number };

/** A span to replace by `text` when its format is removed. */
type Removal = { start: number; end: number; text: string };

/** The list marker of a line, including a bare one that awaits its text. */
function marker(line: string): ListMarker | undefined {
	const bare = BARE_MARKER.exec(line);
	if (!bare) return listMarker(line);
	return { length: bare[0].length, ordered: bare[1] !== undefined, start: Number(bare[1] ?? 1) };
}

/** The selection within its line, or nothing when it spans lines. */
function lineSelection({ value, start, end }: BodySelection): LineSelection | undefined {
	const offset = value.lastIndexOf('\n', start - 1) + 1;
	const lineEnd = value.indexOf('\n', start);
	if (lineEnd !== -1 && end > lineEnd) return undefined;
	const line = value.slice(offset, lineEnd === -1 ? undefined : lineEnd);
	return { offset, line, from: start - offset, to: end - offset };
}

/** The selection without surrounding whitespace, so `word ` wraps as `word`. */
function trimmed({ value, start, end }: BodySelection): BodySelection {
	let [from, to] = [start, end];
	while (from < to && /\s/.test(value[from] ?? '')) from++;
	while (to > from && /\s/.test(value[to - 1] ?? '')) to--;
	return { value, start: from, end: to };
}

/** Whether `start..end` overlaps the selection. A caret on its edge is outside it. */
function touches({ from, to }: LineSelection, start: number, end: number): boolean {
	return from === to ? start < from && from < end : start < to && from < end;
}

/** Whether new markup over the selection would split the list marker or a placeholder. */
function cutsTemplate(selection: LineSelection): boolean {
	const { line, from, to } = selection;
	if (from < (marker(line)?.length ?? 0)) return true;
	return [...line.matchAll(PLACEHOLDER)].some(({ index, 0: token }) => {
		const end = index + token.length;
		return touches(selection, index, end) && !(from <= index && end <= to);
	});
}

/**
 * Whether `token` in place of the selection reads as one `kind` span there. New
 * markers can merge with neighbouring text, as `!` before a link makes an image.
 */
function readsAs({ line, from, to }: LineSelection, token: string, kind: 'bold' | 'link') {
	const next = line.slice(0, from) + token + line.slice(to);
	return markupSpans(next).some(
		(span) => span.kind === kind && span.start === from && span.end === from + token.length
	);
}

/** The bold or link span around the selection, when it lies inside one. */
function enclosingSpan({ line, from, to }: LineSelection, kind: 'bold' | 'link') {
	return markupSpans(line).find(
		(span) =>
			span.kind === kind &&
			(from === to ? span.start < from && from < span.end : span.start <= from && to <= span.end)
	);
}

/**
 * Empty markup around a caret that the next typed character fills, such as the
 * `**|**` Bold leaves at a caret, found by typing a stand-in there.
 */
function emptyAt({ line, from, to }: LineSelection, kind: 'bold' | 'link'): Removal | undefined {
	if (from !== to) return undefined;
	const span = markupSpans(`${line.slice(0, from)}x${line.slice(from)}`).find(
		(span) =>
			span.start < from &&
			from < span.end &&
			((span.kind === 'bold' && span.text === 'x') || (span.kind === 'link' && span.label === 'x'))
	);
	return span?.kind === kind ? { start: span.start, end: span.end - 1, text: '' } : undefined;
}

/** The bold around the selection, or the empty bold at a caret. */
function boldAt(selection: LineSelection): Removal | undefined {
	const bold = enclosingSpan(selection, 'bold');
	if (bold?.kind === 'bold') return { start: bold.start, end: bold.end, text: bold.text };
	return emptyAt(selection, 'bold');
}

/** The link around the selection, or the empty link label at a caret. */
function linkAt(selection: LineSelection): Removal | undefined {
	const link = enclosingSpan(selection, 'link');
	if (link?.kind === 'link') return { start: link.start, end: link.end, text: link.label };
	return emptyAt(selection, 'link');
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

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Remove bold from the selected part of a bold span and keep the rest bold, as
 * `**a «b» c**` becomes `**a **b** c**`. A caret removes the whole span.
 */
function unbold(selection: LineSelection, bold: Removal): BodyEdit {
	const { line, from, to } = selection;
	if (from === to) {
		const caret = clamp(from - 2, bold.start, bold.start + bold.text.length);
		return lineEdit(selection, bold.start, bold.end, bold.text, [caret, caret]);
	}
	const [textStart, textEnd] = [bold.start + 2, bold.end - 2];
	let [cutStart, cutEnd] = [clamp(from, textStart, textEnd), clamp(to, textStart, textEnd)];
	if (cutStart === cutEnd) [cutStart, cutEnd] = [textStart, textEnd];
	const wrap = (part: string) => (part ? `**${part}**` : '');
	const head = wrap(line.slice(textStart, cutStart));
	const text = head + line.slice(cutStart, cutEnd) + wrap(line.slice(cutEnd, textEnd));
	const selected = bold.start + head.length;
	return lineEdit(selection, bold.start, bold.end, text, [selected, selected + cutEnd - cutStart]);
}

/**
 * Bold the selection, or remove bold from it. A selection that is partly bold
 * becomes one bold span, and a caret at the end of bold text steps out of it,
 * so typing goes on unbolded, as in a word processor.
 */
export function toggleBold(selection: BodySelection): BodyEdit | undefined {
	const line = lineSelection(trimmed(selection));
	if (!line) return undefined;
	const bold = boldAt(line);
	if (bold?.text && line.from === line.to && line.from === bold.end - 2) {
		return lineEdit(line, line.from, line.from, '', [bold.end, bold.end]);
	}
	if (bold) return unbold(line, bold);
	const spans = markupSpans(line.line).filter((span) => touches(line, span.start, span.end));
	if (spans.some((span) => span.kind !== 'bold')) return undefined;
	const from = Math.min(line.from, ...spans.map((span) => span.start));
	const to = Math.max(line.to, ...spans.map((span) => span.end));
	const widened = { ...line, from, to };
	if (cutsTemplate(widened)) return undefined;
	let text = line.line.slice(from, to);
	for (const span of spans.toReversed()) {
		if (span.kind !== 'bold') continue;
		text = text.slice(0, span.start - from) + span.text + text.slice(span.end - from);
	}
	// A caret checks with a stand-in for the text the user types next.
	if (!readsAs(widened, `**${text || 'x'}**`, 'bold')) return undefined;
	return lineEdit(line, from, to, `**${text}**`, [from + 2, from + 2 + text.length]);
}

/**
 * Link the selection with an empty `https://` target selected for the URL, or
 * remove the link the selection lies in and keep its label.
 */
export function toggleLink(selection: BodySelection): BodyEdit | undefined {
	const line = lineSelection(trimmed(selection));
	if (!line) return undefined;
	const link = linkAt(line);
	if (link) {
		const end = link.start + link.text.length;
		const caret = clamp(line.from - 1, link.start, end);
		return lineEdit(
			line,
			link.start,
			link.end,
			link.text,
			line.from === line.to ? [caret, caret] : [link.start, end]
		);
	}
	const label = line.line.slice(line.from, line.to);
	const overlaps = markupSpans(line.line).some((span) => touches(line, span.start, span.end));
	if (overlaps || cutsTemplate(line)) return undefined;
	if (!readsAs(line, `[${label || 'x'}](https://)`, 'link')) return undefined;
	const urlStart = line.from + label.length + 3;
	return lineEdit(
		line,
		line.from,
		line.to,
		`[${label}](https://)`,
		label ? [urlStart, urlStart + 'https://'.length] : [line.from + 1, line.from + 1]
	);
}

/**
 * Link the selection to a pasted URL when the result renders as a link. A URL
 * pasted over a link's whole target replaces it and puts the caret after the
 * link, so typing goes on outside it.
 */
export function pasteLink(selection: BodySelection, pasted: string): BodyEdit | undefined {
	const url = pasted.trim();
	const line = lineSelection(trimmed(selection));
	if (!line || line.from === line.to || !isAllowedHref(url)) return undefined;
	const target = enclosingSpan(line, 'link');
	if (
		target?.kind === 'link' &&
		line.to === target.end - 1 &&
		line.from === line.to - target.url.length
	) {
		const link = `[${target.label}](${url})`;
		const span = { ...line, from: target.start, to: target.end };
		if (!readsAs(span, link, 'link')) return undefined;
		const end = target.start + link.length;
		return lineEdit(line, target.start, target.end, link, [end, end]);
	}
	if (cutsTemplate(line)) return undefined;
	if (markupSpans(line.line).some((span) => touches(line, span.start, span.end))) return undefined;
	const link = `[${line.line.slice(line.from, line.to)}](${url})`;
	if (!readsAs(line, link, 'link')) return undefined;
	const end = line.from + link.length;
	return lineEdit(line, line.from, line.to, link, [end, end]);
}

/** The lines a selection touches. One ending right after a newline ends on the line before. */
function selectedLines({ value, start, end }: BodySelection) {
	const from = value.lastIndexOf('\n', start - 1) + 1;
	const last = end > start && value[end - 1] === '\n' ? end - 1 : end;
	const lineEnd = value.indexOf('\n', last);
	const to = lineEnd === -1 ? value.length : lineEnd;
	return { from, to, lines: value.slice(from, to).split('\n') };
}

/** The list kind every non-blank selected line shares. */
function listKind(selection: BodySelection): ListKind | undefined {
	const kinds = new Set(
		selectedLines(selection)
			.lines.filter((line) => line.trim())
			.map((line) => {
				const item = marker(line);
				return item && (item.ordered ? 'numbered' : 'bulleted');
			})
	);
	const [kind] = kinds;
	return kinds.size === 1 ? kind : undefined;
}

/** The number a new numbered item starting at `lineStart` continues with. */
function nextNumber(value: string, lineStart: number): number {
	if (lineStart === 0) return 1;
	const above = value.slice(value.lastIndexOf('\n', lineStart - 2) + 1, lineStart - 1);
	const item = marker(above);
	return item?.ordered ? item.start + 1 : 1;
}

/** The formats the toolbar shows as on for a selection. */
export function bodyFormats(selection: BodySelection): BodyFormats {
	const line = lineSelection(trimmed(selection));
	return {
		bold: line !== undefined && boldAt(line) !== undefined,
		link: line !== undefined && linkAt(line) !== undefined,
		list: listKind(selection)
	};
}

/**
 * Make the selected lines a list of `kind`, or plain lines again when they
 * already are one. Blank lines stay blank and numbering skips them; numbers
 * continue a numbered item right above. A caret on a blank line starts an item.
 */
export function toggleList(selection: BodySelection, kind: ListKind): BodyEdit | undefined {
	const { value, start, end } = selection;
	const { from, to, lines } = selectedLines(selection);
	const removing = listKind(selection) === kind;
	let number = nextNumber(value, from);
	const relist = (line: string) => {
		const content = line.slice(marker(line)?.length ?? 0);
		if (removing) return content;
		return `${kind === 'numbered' ? `${number++}.` : '-'} ${content}`;
	};
	if (start === end) {
		// The caret keeps its place in the line's text.
		const [line = ''] = lines;
		const old = line.trim() ? (marker(line)?.length ?? 0) : line.length;
		const text = relist(line.trim() ? line : '');
		const content = line.length - old;
		const caret = from + text.length - content + clamp(start - from - old, 0, content);
		return { from, to, text, select: [caret, caret] };
	}
	if (!lines.some((line) => line.trim())) return undefined;
	const text = lines.map((line) => (line.trim() ? relist(line) : line)).join('\n');
	return { from, to, text, select: [from, from + text.length] };
}

/**
 * Continue a list on Enter at a caret: split the item into a new one and
 * renumber the numbered items below, or end the list when the item is empty.
 * Nothing outside an item's text, so Enter breaks the line as usual.
 */
export function continueList({ value, start, end }: BodySelection): BodyEdit | undefined {
	if (start !== end) return undefined;
	const from = value.lastIndexOf('\n', start - 1) + 1;
	const lineEnd = value.indexOf('\n', start);
	const to = lineEnd === -1 ? value.length : lineEnd;
	const line = value.slice(from, to);
	const item = marker(line);
	if (!item || start - from < item.length) return undefined;
	if (!line.slice(item.length).trim()) return { from, to, text: '', select: [from, from] };
	let number = item.start + 1;
	const next = item.ordered ? `${number}. ` : '- ';
	let text = `\n${next}${value.slice(start, to)}`;
	let replaced = to;
	while (item.ordered && replaced < value.length) {
		const lineStart = replaced + 1;
		const belowEnd = value.indexOf('\n', lineStart);
		const below = value.slice(lineStart, belowEnd === -1 ? undefined : belowEnd);
		const belowItem = marker(below);
		if (!belowItem?.ordered) break;
		number += 1;
		text += `\n${number}. ${below.slice(belowItem.length)}`;
		replaced = belowEnd === -1 ? value.length : belowEnd;
	}
	const caret = start + 1 + next.length;
	return { from: start, to: replaced, text, select: [caret, caret] };
}

/** Remove the list marker on Backspace at the start of an item's text. */
export function removeListMarker({ value, start, end }: BodySelection): BodyEdit | undefined {
	if (start !== end) return undefined;
	const from = value.lastIndexOf('\n', start - 1) + 1;
	const lineEnd = value.indexOf('\n', start);
	const item = marker(value.slice(from, lineEnd === -1 ? undefined : lineEnd));
	if (!item || start - from !== item.length) return undefined;
	return { from, to: start, text: '', select: [from, from] };
}

/**
 * Insert a `{{name}}` placeholder in place of the selection, widened over any
 * placeholder it cuts so choosing a variable inside one replaces it.
 */
export function insertVariable(
	{ value, start, end }: BodySelection,
	name: keyof FounderTemplateVariables
): BodyEdit {
	let [from, to] = [start, end];
	for (const { index, 0: token } of value.matchAll(PLACEHOLDER)) {
		const tokenEnd = index + token.length;
		const cuts =
			start === end ? index < start && start < tokenEnd : index < end && start < tokenEnd;
		if (cuts) [from, to] = [Math.min(from, index), Math.max(to, tokenEnd)];
	}
	const text = `{{${name}}}`;
	return { from, to, text, select: [from + text.length, from + text.length] };
}
