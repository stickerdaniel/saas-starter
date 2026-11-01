import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// WCAG 2 AA for normal-size text. Muted text carries placeholders, group headings,
// footers and keyboard hints, which sit on the muted surface as well as the page.
const AA_NORMAL_TEXT = 4.5;

const css = readFileSync(path.resolve('src/routes/layout.css'), 'utf8');

function tokens(selector: string): Map<string, string> {
	const start = css.indexOf(`${selector} {`);
	const block = css.slice(start, css.indexOf('}', start));
	return new Map([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

/** sRGB relative luminance of an opaque `oklch(L C H)` color. */
function luminance(value: string): number {
	const match = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value);
	if (!match) throw new Error(`not an opaque oklch color: ${value}`);
	const [L, C, H] = match.slice(1).map(Number) as [number, number, number];
	const a = C * Math.cos((H * Math.PI) / 180);
	const b = C * Math.sin((H * Math.PI) / 180);
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const clamp = (x: number) => Math.min(1, Math.max(0, x));
	const r = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
	const g = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
	const bl = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
	return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (hi + 0.05) / (lo + 0.05);
}

describe.each([
	['light', ':root'],
	['dark', '.dark']
])('%s theme', (_, selector) => {
	const theme = tokens(selector);

	it.each(['background', 'card', 'popover', 'muted', 'secondary', 'accent'])(
		'muted text stays readable on %s',
		(surface) => {
			expect(contrast(theme.get('muted-foreground')!, theme.get(surface)!)).toBeGreaterThanOrEqual(
				AA_NORMAL_TEXT
			);
		}
	);
});
