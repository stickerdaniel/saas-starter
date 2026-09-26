import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The learn-more hover motion must stay inside the fine-pointer media query:
 * outside it, a tap on a touch screen leaves the chevron and arms stuck in their
 * hover pose.
 */

const root = join(import.meta.dirname, '../..');

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

const css = readFileSync(join(root, 'src/routes/layout.css'), 'utf8');

describe('learn-more interaction parity', () => {
	const learnMoreStart = css.indexOf('/* Learn more hover:');
	const hoverMarker = '@media (hover: hover) and (pointer: fine)';
	const hoverCss = blockBody(css, hoverMarker, learnMoreStart);

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
});
