export interface CodeMeta {
	title: string | null;
	lineNumbers: boolean;
	/** One-based line numbers from `{2}` or `{1,4-6}`, each within the fence's lines. */
	highlighted: ReadonlySet<number>;
}

/**
 * Reads the rest of a fence's info string after its language, such as
 * `title="svelte.config.js" {6} showLineNumbers`, with the words the shadcn-svelte docs use,
 * for a fence of `lineCount` lines.
 */
export function parseCodeMeta(meta: string | null | undefined, lineCount: number): CodeMeta {
	const text = meta ?? '';
	const unquoted = text.replace(/"[^"]*"/g, '');
	const highlighted = new Set<number>();
	for (const [, ranges] of unquoted.matchAll(/\{([\d,\s-]+)\}/g)) {
		for (const range of ranges!.split(',')) {
			const [from, to = from] = range.trim().split('-').map(Number);
			if (!Number.isInteger(from) || !Number.isInteger(to) || from! < 1) continue;
			for (let line = from!; line <= Math.min(to!, lineCount); line++) highlighted.add(line);
		}
	}
	return {
		title: /\btitle="([^"]*)"/.exec(text)?.[1] ?? null,
		lineNumbers: /\bshowLineNumbers\b/.test(unquoted),
		highlighted
	};
}
