import type { DocsNavEntry } from './engine';

export interface DocsNavSection {
	section: string;
	entries: DocsNavEntry[];
}

/** The catalog's pages grouped by section, sections in the order of their first page. */
export function navSections(navigation: readonly DocsNavEntry[]): DocsNavSection[] {
	const sections = new Map<string, DocsNavEntry[]>();
	for (const entry of navigation) {
		sections.set(entry.section, [...(sections.get(entry.section) ?? []), entry]);
	}
	return [...sections].map(([section, entries]) => ({ section, entries }));
}
