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

function blockBody(source: string, marker: string, from = 0): string {
	const markerIndex = source.indexOf(marker, from);
	if (markerIndex === -1) throw new Error(`Missing CSS block ${marker}`);
	const open = source.indexOf('{', markerIndex);
	if (open === -1) throw new Error(`Missing opening brace for ${marker}`);
	let depth = 0;
	for (let index = open; index < source.length; index += 1) {
		if (source[index] === '{') depth += 1;
		if (source[index] !== '}') continue;
		depth -= 1;
		if (depth === 0) return source.slice(open + 1, index);
	}
	throw new Error(`Missing closing brace for ${marker}`);
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
	const learnMoreStart = css.indexOf('/* Learn more hover:');
	const hoverMarker = '@media (hover: hover) and (pointer: fine)';
	const hoverCapabilityStart = css.indexOf(hoverMarker, learnMoreStart);
	const hoverCss = blockBody(css, hoverMarker, learnMoreStart);

	it('moves and spreads both arms on keyboard focus outside hover capability', () => {
		const focusRule = css.indexOf('.t-learn:focus-visible .t-learn-chevron {', learnMoreStart);
		expect(focusRule).toBeGreaterThan(learnMoreStart);
		expect(focusRule).toBeLessThan(hoverCapabilityStart);
		expect(blockBody(css, '.t-learn:focus-visible .t-learn-chevron', learnMoreStart)).toMatch(
			/translateX\(var\(--learn-shift\)\)/
		);
		expect(blockBody(css, '.t-learn:focus-visible .t-learn-arm', learnMoreStart)).toMatch(
			/transition-duration:\s*var\(--learn-in\)/
		);
		expect(blockBody(css, '.t-learn:focus-visible .t-learn-arm-top', learnMoreStart)).toMatch(
			/rotate\(var\(--learn-spread\)\)/
		);
		expect(blockBody(css, '.t-learn:focus-visible .t-learn-arm-bot', learnMoreStart)).toMatch(
			/rotate\(calc\(var\(--learn-spread\) \* -1\)\)/
		);
	});

	it('keeps the complete hover motion inside fine-pointer capability', () => {
		expect(blockBody(hoverCss, '.t-learn:hover .t-learn-chevron')).toMatch(
			/translateX\(var\(--learn-shift\)\)/
		);
		expect(blockBody(hoverCss, '.t-learn:hover .t-learn-arm')).toMatch(
			/transition-duration:\s*var\(--learn-in\)/
		);
		expect(blockBody(hoverCss, '.t-learn:hover .t-learn-arm-top')).toMatch(
			/rotate\(var\(--learn-spread\)\)/
		);
		expect(blockBody(hoverCss, '.t-learn:hover .t-learn-arm-bot')).toMatch(
			/rotate\(calc\(var\(--learn-spread\) \* -1\)\)/
		);
	});

	it('points and moves along the RTL reading direction', () => {
		expect(blockBody(css, ":where([dir='rtl']) .t-learn-chevron", learnMoreStart)).toMatch(
			/scaleX\(-1\)/
		);
		expect(
			blockBody(css, ":where([dir='rtl']) .t-learn:focus-visible .t-learn-chevron", learnMoreStart)
		).toMatch(/translateX\(calc\(var\(--learn-shift\) \* -1\)\).*scaleX\(-1\)/s);
		expect(blockBody(hoverCss, ":where([dir='rtl']) .t-learn:hover .t-learn-chevron")).toMatch(
			/translateX\(calc\(var\(--learn-shift\) \* -1\)\).*scaleX\(-1\)/s
		);
	});
});

describe('learn-more consumers', () => {
	const hero = readFileSync(join(root, 'src/blocks/hero/hero-five.svelte'), 'utf8');
	const integration = readFileSync(
		join(root, 'src/blocks/integration/card/integration-card.svelte'),
		'utf8'
	);
	const support = readFileSync(
		join(root, 'src/lib/components/customer-support/threads-overview.svelte'),
		'utf8'
	);
	const wiredControl =
		/<(?:Button|button)\b[^>]*class="[^"]*\bt-learn\b[^"]*"[^>]*>[\s\S]*?<LearnMoreChevron\b[\s\S]*?<\/(?:Button|button)>/g;

	it('keeps every real chevron below a focusable motion owner', () => {
		expect(hero.match(wiredControl)).toHaveLength(1);
		expect(integration.match(wiredControl)).toHaveLength(2);
		expect(support.match(wiredControl)).toHaveLength(1);
	});
});
