import { escapeHtml } from './html';

/**
 * Placeholder and markup rendering for the founder welcome email, shared by the
 * sender and the admin preview.
 */

/** The placeholders a founder email template may use. */
export const FOUNDER_TEMPLATE_VARIABLES = [
	'userFirstName',
	'userLastName',
	'founderName',
	'founderTitle'
] as const;

export type FounderTemplateVariables = Record<(typeof FOUNDER_TEMPLATE_VARIABLES)[number], string>;

/**
 * Render a plain-text founder template. `{{name}}` placeholders resolve from
 * `vars`; an unknown placeholder renders as an empty string.
 */
export function renderFounderTemplate(template: string, vars: FounderTemplateVariables): string {
	const lookup = new Map(Object.entries(vars));
	return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => lookup.get(key) ?? '');
}

type Inline =
	| { kind: 'text'; text: string }
	| { kind: 'link'; label: string; href: string }
	| { kind: 'bold'; text: string };

// Neither construct spans a line, so the renderer tokenizes line by line. The
// first group matches unsupported markup first, so it stays literal instead of
// rendering a link or bold inside it: an image or double-bracket link with its
// attached target up to the first `)` (or the line end), and runs of three or
// more stars.
const MARKUP =
	/((?:!\[|\[\[)[^\]\n]*\](?:\([^)\n]*\)?)?|\*{3,}[^*\n]*\*{3,}|\*{3,})|\[([^[\]\n]+)\]\(([^()\s]+)\)|\*\*([^*\n]+)\*\*/g;
// A list item starts its line with `- ` or a number and `. `. The marker is read
// from the template line, so a substituted value cannot start a list.
const LIST_ITEM = /^(?:-|(\d{1,9})\.)[ \t]+(?=\S)/;
const LINK_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);
const FOUNDER_EMAIL_STYLE =
	"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#000";

/**
 * Whether a substituted link target is safe to send as an `href`. Web links must
 * spell out `//host`: `https:example.com` parses as absolute here but resolves
 * relative to the page in a mail client. Invisible format characters, such as a
 * right-to-left override, could disguise the shown URL.
 */
export function isAllowedHref(url: string): boolean {
	if (/[\s\p{Cc}\p{Cf}]/u.test(url)) return false;
	if (/^https?:/i.test(url) && !/^https?:\/\/[^/]/i.test(url)) return false;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	return LINK_PROTOCOLS.has(parsed.protocol) && !parsed.username && !parsed.password;
}

/** Tokenize one template line, then substitute placeholders inside each token. */
function renderLine(line: string, vars: FounderTemplateVariables): Inline[] {
	const fill = (part: string) => renderFounderTemplate(part, vars);
	const inlines: Inline[] = [];
	let cursor = 0;
	const pushTextUntil = (end: number) => {
		if (end > cursor) inlines.push({ kind: 'text', text: fill(line.slice(cursor, end)) });
	};
	for (const match of line.matchAll(MARKUP)) {
		const [raw, literal, label, url, bold] = match;
		pushTextUntil(match.index);
		cursor = match.index + raw.length;
		if (literal !== undefined) {
			inlines.push({ kind: 'text', text: fill(raw) });
			continue;
		}
		if (bold !== undefined) {
			inlines.push({ kind: 'bold', text: fill(bold) });
			continue;
		}
		const href = fill(url ?? '');
		inlines.push(
			isAllowedHref(href)
				? { kind: 'link', label: fill(label ?? ''), href }
				: { kind: 'text', text: fill(raw) }
		);
	}
	pushTextUntil(line.length);
	return inlines;
}

function inlineText(inline: Inline): string {
	if (inline.kind !== 'link') return inline.text;
	return inline.label === inline.href ? inline.href : `${inline.label} <${inline.href}>`;
}

function inlineHtml(inline: Inline): string {
	switch (inline.kind) {
		case 'text':
			return escapeHtml(inline.text);
		case 'bold':
			return `<strong>${escapeHtml(inline.text)}</strong>`;
		case 'link':
			return `<a href="${escapeHtml(inline.href)}">${escapeHtml(inline.label)}</a>`;
	}
}

type Line = { html: string; text: string; list?: { ordered: boolean; start: number } };

/** Render one template line, splitting off a list marker first. */
function renderBodyLine(line: string, vars: FounderTemplateVariables): Line {
	const marker = LIST_ITEM.exec(line);
	const inlines = renderLine(marker ? line.slice(marker[0].length) : line, vars);
	return {
		html: inlines.map(inlineHtml).join(''),
		text: (marker?.[0] ?? '') + inlines.map(inlineText).join(''),
		list: marker ? { ordered: marker[1] !== undefined, start: Number(marker[1] ?? 1) } : undefined
	};
}

type Block = { tag: 'p' | 'ul' | 'ol'; start: number; lines: string[] };

function blockHtml({ tag, start, lines }: Block): string {
	if (tag === 'p') return `<p>${lines.join('<br>')}</p>`;
	const startAttr = tag === 'ol' && start !== 1 ? ` start="${start}"` : '';
	return `<${tag}${startAttr}>${lines.map((line) => `<li>${line}</li>`).join('')}</${tag}>`;
}

/**
 * Render a founder email body as its text and HTML parts. The markup is exactly
 * `[label](url)`, `**bold**`, and list items on lines starting with `- ` or `1. `;
 * anything else, malformed or unsupported, stays literal text. The template is
 * tokenized before `{{name}}` placeholders resolve, so a substituted value can
 * never create markup. A link whose substituted URL is not an absolute `https:`,
 * `http:` or `mailto:` URL without credentials renders literally. A line that
 * renders empty separates paragraphs and lists, a single newline is a line break,
 * and consecutive list items of one kind form one list; the text part keeps the
 * template's lines exactly.
 */
export function renderFounderEmail(
	template: string,
	vars: FounderTemplateVariables
): { text: string; html: string } {
	const lines = template
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => renderBodyLine(line, vars));

	const blocks: Block[] = [];
	let open: Block | undefined;
	for (const line of lines) {
		if (!line.text.trim()) {
			open = undefined;
			continue;
		}
		const tag = line.list ? (line.list.ordered ? 'ol' : 'ul') : 'p';
		if (open?.tag !== tag) {
			open = { tag, start: line.list?.start ?? 1, lines: [] };
			blocks.push(open);
		}
		open.lines.push(line.html);
	}

	return {
		text: lines.map((line) => line.text).join('\n'),
		html: `<div style="${FOUNDER_EMAIL_STYLE}">${blocks.map(blockHtml).join('')}</div>`
	};
}
