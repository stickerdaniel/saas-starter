/**
 * Returns the index just past the at-rule whose prelude starts at `from`,
 * covering both the `(...)` shorthand and the `{ ... }` block form.
 */
function findAtRuleEnd(css: string, from: number): number {
	let depth = 0;
	for (let index = from; index < css.length; index++) {
		const char = css[index];
		if (char === '(' || char === '{') {
			depth++;
		} else if (char === ')' || char === '}') {
			depth--;
			if (depth === 0 && char === '}') return index + 1;
		} else if (char === ';' && depth === 0) {
			return index + 1;
		}
	}
	return -1;
}

/**
 * Drops the app's class-based `dark` variant from the shared layout CSS.
 *
 * The app declares `@custom-variant dark (&:is(.dark *))`, which outranks the
 * renderer's `darkMode` setting and compiles every `dark:` utility down to a
 * `.dark` ancestor selector. No email client ever renders that ancestor, so the
 * variant has to go before `darkMode: 'media'` in renderer.ts can compile those
 * utilities to `prefers-color-scheme` instead. Only `dark` is removed: the
 * `data-*` custom variants in the same file still resolve their own utilities.
 */
function removeDarkCustomVariant(css: string): string {
	let result = '';
	let cursor = 0;
	for (const match of css.matchAll(/@custom-variant\s+dark\b/g)) {
		const end = findAtRuleEnd(css, match.index + match[0].length);
		if (end === -1) continue;
		result += css.slice(cursor, match.index);
		cursor = end;
	}
	return result + css.slice(cursor);
}

export function sanitizeEmailCss(css: string): string {
	return removeDarkCustomVariant(css).replace(/cursor\s*:\s*url\([^;]+;/g, '');
}
