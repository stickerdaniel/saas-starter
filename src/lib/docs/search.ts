export interface DocsSearchSection {
	/** The heading id, or null for the text above a page's first heading. */
	id: string | null;
	heading: string;
	text: string;
}

export interface DocsSearchPage {
	slug: string;
	title: string;
	sections: DocsSearchSection[];
}

export interface DocsSearchResult {
	slug: string;
	title: string;
	/** The section that matched, null when the title matched. */
	section: { id: string; heading: string } | null;
}

const RANK = { title: 0, heading: 1, text: 2 } as const;

function words(query: string): string[] {
	return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function holdsAll(text: string, terms: readonly string[]): boolean {
	const haystack = text.toLowerCase();
	return terms.every((term) => haystack.includes(term));
}

function bestMatch(
	page: DocsSearchPage,
	terms: readonly string[]
): { rank: number; section: DocsSearchResult['section'] } | null {
	if (holdsAll(page.title, terms)) return { rank: RANK.title, section: null };
	const sections = page.sections.filter(
		(section): section is DocsSearchSection & { id: string } => section.id !== null
	);
	const heading = sections.find((section) => holdsAll(section.heading, terms));
	if (heading) return { rank: RANK.heading, section: { id: heading.id, heading: heading.heading } };
	const text = page.sections.find((section) =>
		holdsAll(`${section.heading} ${section.text}`, terms)
	);
	if (!text) return null;
	return {
		rank: RANK.text,
		section: text.id === null ? null : { id: text.id, heading: text.heading }
	};
}

/**
 * The pages that hold every word of `query`, one result per page: title matches first, then
 * heading matches, then text matches, each in catalog order.
 */
export function searchDocs(
	index: readonly DocsSearchPage[],
	query: string,
	limit = 10
): DocsSearchResult[] {
	const terms = words(query);
	if (terms.length === 0) return [];
	return index
		.flatMap((page, order) => {
			const match = bestMatch(page, terms);
			return match ? [{ ...match, order, page }] : [];
		})
		.toSorted((a, b) => a.rank - b.rank || a.order - b.order)
		.slice(0, limit)
		.map(({ page, section }) => ({ slug: page.slug, title: page.title, section }));
}
