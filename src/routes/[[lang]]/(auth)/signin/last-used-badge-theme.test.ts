/**
 * The "last used" badge overlaps a button that fades itself with
 * `disabled:opacity-50`, so it cannot fade too without letting that edge show
 * through. It mixes an opaque half-strength secondary against `--card` instead.
 *
 * What this guards is where that mix is written. A custom property declared on
 * `:root` computes its `color-mix()` at the root and inherits only the result,
 * so a card or shell that scopes `--secondary` or `--card` would be ignored
 * while the badge still rendered a perfectly plausible colour. Written as
 * declarations inside a `@utility`, the `var()` lookups resolve on the badge.
 *
 * No assertion about the rendered colour under the root theme can tell those
 * two apart, which is why the browser test that used to carry this had to
 * override both variables on a wrapper and read the computed value back. It is
 * structural here because the failure is a plausible refactor of two
 * declarations into a token, and because resolving `var()` at the element is a
 * CSS engine property rather than something this app can get wrong by itself.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Only `/* ... *\/` is a comment in CSS. The `//` stripping the sibling
 * structural test does would truncate a line at the `//` of any URL, and a
 * truncated line is exactly how the hoisting scan below could miss a
 * declaration and pass a broken file.
 */
function withoutCssComments(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

function normalized(text: string): string {
	return text.replace(/\s+/g, '');
}

const css = withoutCssComments(readFileSync(path.resolve('src/routes/layout.css'), 'utf8'));
const markup = readFileSync(
	path.resolve('src/routes/[[lang]]/(auth)/signin/OAuthButtons.svelte'),
	'utf8'
);

const UTILITY = 'badge-secondary-disabled';

describe('disabled last-used badge theming', () => {
	it('declares the mix inside the utility, where var() resolves on the badge', () => {
		const body = css.match(new RegExp(`@utility\\s+${UTILITY}\\s*\\{([^}]*)\\}`))?.[1];
		expect(body).toBeDefined();
		expect(normalized(body!)).toContain(
			normalized('background-color: color-mix(in srgb, var(--secondary) 50%, var(--card));')
		);
		expect(normalized(body!)).toContain(
			normalized('color: color-mix(in srgb, var(--secondary-foreground) 50%, var(--card));')
		);
	});

	it('never hoists that mix into a custom property', () => {
		const hoisted = css
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => /^--[\w-]+\s*:/.test(line))
			.filter((line) => line.includes('color-mix'))
			.filter((line) => /var\(--secondary(-foreground)?\)/.test(line));
		expect(hoisted).toEqual([]);
	});

	it('applies the utility to the badge it themes', () => {
		expect(markup).toContain(`group-has-[[data-slot=button]:disabled]:${UTILITY}`);
	});
});
