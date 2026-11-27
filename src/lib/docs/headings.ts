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

/** The text a reader sees: inline Markdown syntax removed, images and raw HTML dropped. */
export function plainText(tokens: readonly TextToken[] | undefined): string {
	return (tokens ?? [])
		.map((token) => {
			if (token.type === 'image' || token.type === 'html') return '';
			if (token.tokens) return plainText(token.tokens);
			return token.text ?? '';
		})
		.join('');
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
		const id = this.next(plainText(token.tokens));
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
			text: plainText(token.tokens),
			depth: token.depth,
			children: []
		};
		while (open.length > 0 && open.at(-1)!.depth >= heading.depth) open.pop();
		(open.at(-1)?.children ?? root).push(heading);
		open.push(heading);
	}
	return root;
}
