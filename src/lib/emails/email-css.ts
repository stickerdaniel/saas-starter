/**
 * Skips syntax whose punctuation does not delimit an at-rule. The returned
 * index points just past a comment, string, or escaped character.
 */
function skipProtectedCss(css: string, from: number): number | undefined {
	if (css.startsWith('/*', from)) {
		const end = css.indexOf('*/', from + 2);
		return end === -1 ? css.length : end + 2;
	}

	const quote = css[from];
	if (quote !== "'" && quote !== '"') {
		return quote === '\\' ? Math.min(from + 2, css.length) : undefined;
	}

	for (let index = from + 1; index < css.length; index++) {
		if (css[index] === '\\') {
			index++;
		} else if (css[index] === quote) {
			return index + 1;
		}
	}
	return css.length;
}

/**
 * Finds real `@custom-variant dark` preludes rather than matching their text
 * inside comments or strings.
 */
function findDarkCustomVariants(css: string): Array<{ start: number; preludeEnd: number }> {
	const variants: Array<{ start: number; preludeEnd: number }> = [];
	let canStartAtRule = true;
	for (let index = 0; index < css.length; index++) {
		if (css.startsWith('/*', index)) {
			index = skipProtectedCss(css, index)! - 1;
			continue;
		}

		const skippedTo = skipProtectedCss(css, index);
		if (skippedTo !== undefined) {
			canStartAtRule = false;
			index = skippedTo - 1;
			continue;
		}

		const char = css[index]!;
		if (/\s/.test(char)) continue;
		if (char === '@' && canStartAtRule) {
			const match = css.slice(index).match(/^@custom-variant\s+dark(?![-_a-zA-Z0-9\\])/);
			if (match) {
				variants.push({ start: index, preludeEnd: index + match[0].length });
				index += match[0].length - 1;
			}
		}
		canStartAtRule = char === '{' || char === '}' || char === ';';
	}
	return variants;
}

/**
 * Returns the index just past the at-rule whose prelude starts at `from`,
 * covering both the `(...)` shorthand and the `{ ... }` block form.
 */
function findAtRuleEnd(css: string, from: number): number {
	let depth = 0;
	for (let index = from; index < css.length; index++) {
		const skippedTo = skipProtectedCss(css, index);
		if (skippedTo !== undefined) {
			index = skippedTo - 1;
			continue;
		}

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
	for (const variant of findDarkCustomVariants(css)) {
		if (variant.start < cursor) continue;
		const end = findAtRuleEnd(css, variant.preludeEnd);
		if (end === -1) continue;
		result += css.slice(cursor, variant.start);
		cursor = end;
	}
	return result + css.slice(cursor);
}

export function sanitizeEmailCss(css: string): string {
	return removeDarkCustomVariant(css).replace(/cursor\s*:\s*url\([^;]+;/g, '');
}
