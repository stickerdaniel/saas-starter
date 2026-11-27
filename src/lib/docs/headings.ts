import type { Tokens } from 'marked';

interface TextToken {
	type: string;
	text?: string;
	tokens?: readonly TextToken[];
}

export interface DocsHeading {
	id: string;
	text: string;
	depth: number;
	children: DocsHeading[];
}

/**
 * The text a reader sees: inline Markdown syntax removed and raw HTML dropped. Images drop out
 * of anchors and the search index. An accessible name keeps an image's alt text, a line break
 * as a space, and raw HTML as the literal text the renderer shows.
 */
export function plainText(
	tokens: readonly TextToken[] | undefined,
	{ accessible = false }: { accessible?: boolean } = {}
): string {
	return (tokens ?? [])
		.map((token) => {
			if (token.type === 'html' || token.type === 'image')
				return accessible ? (token.text ?? '') : '';
			if (token.type === 'br') return accessible ? ' ' : '';
			if (token.tokens) return plainText(token.tokens, { accessible });
			return token.text ?? '';
		})
		.join('');
}

/** The name assistive technology reads for inline tokens, with runs of whitespace as one space. */
export function accessibleName(tokens: readonly TextToken[] | undefined): string {
	return plainText(tokens, { accessible: true }).replace(/\s+/g, ' ').trim();
}

/**
 * A heading's text for its id, the table of contents and the search index: its visible text, or
 * its accessible name when it shows no text, as a heading that holds an image alone.
 */
export function headingText(tokens: readonly TextToken[] | undefined): string {
	const text = plainText(tokens);
	return text.trim() ? text : accessibleName(tokens);
}

/**
 * Whether inline tokens render a link or an image. A heading does not wrap either in its
 * permalink: a link inside a link is invalid, and an image is a block inside an inline link.
 */
export function holdsLinkOrImage(tokens: readonly TextToken[] | undefined): boolean {
	return (tokens ?? []).some(
		(token) => token.type === 'link' || token.type === 'image' || holdsLinkOrImage(token.tokens)
	);
}

/** GitHub's anchor for a heading text. */
export function headingSlug(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
		.replace(/ /g, '-');
}

/** Heading ids in document order, suffixed for duplicates as GitHub suffixes them. */
export class HeadingIds {
	readonly #occurrences = new Map<string, number>();
	readonly #assigned = new WeakMap<Tokens.Heading, string>();

	constructor(title: string) {
		this.next(title);
	}

	next(text: string): string {
		const base = headingSlug(text);
		let id = base;
		while (this.#occurrences.has(id)) {
			const count = this.#occurrences.get(base)! + 1;
			this.#occurrences.set(base, count);
			id = `${base}-${count}`;
		}
		this.#occurrences.set(id, 0);
		return id;
	}

	of(token: Tokens.Heading): string {
		const assigned = this.#assigned.get(token);
		if (assigned !== undefined) return assigned;
		const id = this.next(headingText(token.tokens));
		this.#assigned.set(token, id);
		return id;
	}
}

export function headingTree(title: string, headings: readonly Tokens.Heading[]): DocsHeading[] {
	const ids = new HeadingIds(title);
	const root: DocsHeading[] = [];
	const open: DocsHeading[] = [];
	for (const token of headings) {
		const heading: DocsHeading = {
			id: ids.of(token),
			text: headingText(token.tokens),
			depth: token.depth,
			children: []
		};
		while (open.length > 0 && open.at(-1)!.depth >= heading.depth) open.pop();
		(open.at(-1)?.children ?? root).push(heading);
		open.push(heading);
	}
	return root;
}
