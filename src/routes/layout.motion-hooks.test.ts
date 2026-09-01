import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The `t-*` block in layout.css drives every ported transition, and it drives it
 * through class hooks the components have to spell out by hand. A rule whose
 * hook nobody applies fails silently and in the worst direction: the badge's
 * closing rule targeted `.t-badge-dot`, the component never set it, and a red
 * "0" pill sat on the support launcher on every page while every check passed.
 */

const root = join(import.meta.dirname, '../..');

function componentFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
			componentFiles(path, out);
		} else if (entry.name.endsWith('.svelte')) {
			out.push(path);
		}
	}
	return out;
}

/**
 * Only what a component actually renders counts. Three kinds of text mention a
 * hook without applying it, and each of them let a real miss through when it was
 * counted: a CSS selector (`querySelectorAll('.t-avatar')`), a comment naming
 * the rule it pairs with, and a substring of a longer word (`t-stream` inside
 * `application/octet-stream`, `t-switch` inside `t-switch-thumb`). So: comments
 * are stripped, dotted selector forms are dropped, `.ts` files are left out
 * entirely, and the rest is compared as whole class tokens.
 *
 * What this still cannot see: whether a hook sits where its rule expects it.
 * Moving `t-badge-dot` onto the same element as `t-badge` keeps every assertion
 * green while `.t-badge[data-open='false'] .t-badge-dot` stops matching. Proving
 * that needs a rendered tree, and this suite's jsdom project resolves Svelte's
 * server build and cannot mount a component.
 */
function renderedClassTokens(source: string): string[] {
	const withoutComments = source
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/(^|[^:])\/\/.*$/gm, '$1 ');
	return withoutComments.replace(/\.[A-Za-z_-][\w-]*/g, ' ').split(/[^A-Za-z0-9-]+/);
}

const css = readFileSync(join(root, 'src/routes/layout.css'), 'utf8');
const hooks = [...new Set([...css.matchAll(/\.(t-[a-z0-9-]+)/g)].map((m) => m[1]))].sort();

const applied = new Set(
	componentFiles(join(root, 'src')).flatMap((path) =>
		renderedClassTokens(readFileSync(path, 'utf8'))
	)
);

describe('motion class hooks', () => {
	it('finds hooks to check', () => {
		expect(hooks.length).toBeGreaterThan(10);
	});

	it.each(hooks)('%s is applied by a component', (hook) => {
		expect(applied).toContain(hook);
	});
});

/**
 * The tick draws from whichever end of the path the dash offset hides last, so
 * the sign of that offset has to agree with the icon's own point order. Lucide's
 * `check` is authored from the long arm's tip inwards, the reverse of how the
 * mark is written, and a positive offset therefore drew it backwards while every
 * timing value still matched the recipe. Nothing rendered is wrong in that
 * state, which is why it survived a full review round.
 */
describe('checkbox tick draw order', () => {
	const checkbox = readFileSync(
		join(root, 'src/lib/components/ui/checkbox/checkbox.svelte'),
		'utf8'
	);

	it('hides the stroke from the end lucide authors last', () => {
		expect(css).toMatch(
			/\.t-check \.t-check-tick path \{[^}]*stroke-dashoffset:\s*calc\(var\(--check-len[^)]*\)\s*\*\s*-1\)/
		);
	});

	// Matching the identifier alone would accept `CircleCheckIcon`, whose extra
	// circle the dash rule would hold at the hidden offset forever.
	it('renders the exact icon the offset sign was measured against', () => {
		expect(checkbox).toMatch(/from '@lucide\/svelte\/icons\/check'/);
		expect(checkbox).toMatch(/--check-len:23\b/);
	});

	/**
	 * The length and the direction are both properties of one path definition, so
	 * a lucide release that redraws `check` invalidates them together. Read the
	 * installed icon rather than a copy of it: a hand-written fixture would keep
	 * agreeing with itself through exactly the bump this needs to catch.
	 */
	it('pins the lucide path both values were derived from', () => {
		const icon = readFileSync(
			join(root, 'node_modules/@lucide/svelte/dist/icons/check.svelte'),
			'utf8'
		);
		// M20 6 9 17l-5-5: authored from the long arm's tip, length √242 + √50 =
		// 22.63, so --check-len is 23 and the reveal has to run end to start.
		expect(icon).toContain('"d": "M20 6 9 17l-5-5"');
	});
});

describe('learn-more interaction parity', () => {
	it('moves on keyboard focus without requiring hover capability', () => {
		expect(css).toMatch(/\.t-learn:focus-visible \.t-learn-chevron \{/);
		expect(css).toMatch(/\.t-learn:focus-visible \.t-learn-arm-top \{/);
	});

	it('limits hover motion to a fine hover-capable pointer', () => {
		expect(css).toMatch(
			/@media \(hover: hover\) and \(pointer: fine\) \{[\s\S]*?\.t-learn:hover \.t-learn-chevron/
		);
	});

	it('points and moves along the RTL reading direction', () => {
		expect(css).toMatch(/:where\(\[dir='rtl'\]\) \.t-learn-chevron \{[^}]*scaleX\(-1\)/s);
		expect(css).toMatch(
			/:where\(\[dir='rtl'\]\) \.t-learn:focus-visible \.t-learn-chevron \{[^}]*translateX\(calc\(var\(--learn-shift\) \* -1\)\)[^}]*scaleX\(-1\)/s
		);
	});
});
