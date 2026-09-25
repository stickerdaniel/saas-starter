import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';

/**
 * A caller's arrowClasses such as data-[side=top]:translate-y-0 rebuilds translate
 * from --tw-translate-x and --tw-translate-y. When tooltip-arrow-offset assigned
 * translate directly, the axis the caller left alone fell back to 0.
 */

const layoutCss = readFileSync(join(import.meta.dirname, '../../../../routes/layout.css'), 'utf8');

function blockBody(source: string, marker: string): string {
	const markerIndex = source.indexOf(marker);
	if (markerIndex === -1) throw new Error(`Missing CSS block ${marker}`);
	const open = source.indexOf('{', markerIndex);
	let depth = 0;
	for (let index = open; index < source.length; index += 1) {
		if (source[index] === '{') depth += 1;
		if (source[index] !== '}') continue;
		depth -= 1;
		if (depth === 0) return source.slice(open + 1, index);
	}
	throw new Error(`Missing closing brace for ${marker}`);
}

// Declarations of the block itself, without those of nested rules.
function declarations(body: string): Map<string, string> {
	let flat = body;
	while (/\{[^{}]*\}/.test(flat)) flat = flat.replace(/[^;{}]*\{[^{}]*\}/g, '');
	const entries = flat
		.split(';')
		.map((declaration) => declaration.trim())
		.filter(Boolean)
		.map((declaration) => {
			const colon = declaration.indexOf(':');
			return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()] as const;
		});
	return new Map(entries);
}

const utilitySource = `@utility tooltip-arrow-offset {${blockBody(layoutCss, '@utility tooltip-arrow-offset')}}`;
const compiler = await compile(
	`@theme { --spacing: 0.25rem; }\n@tailwind utilities;\n${utilitySource}`
);
const css = compiler.build(['translate-y-0', 'tooltip-arrow-offset']);
const tailwindTranslate = declarations(blockBody(css, '.translate-y-0 {')).get('translate');
const utility = blockBody(css, '.tooltip-arrow-offset {');
const composable =
	'set --tw-translate-x and --tw-translate-y and derive translate from them, so a caller translate-x-* or translate-y-* keeps the other axis';

describe('tooltip-arrow-offset', () => {
	it('derives translate from the axis variables Tailwind utilities write', () => {
		expect(tailwindTranslate).toBe('var(--tw-translate-x) var(--tw-translate-y)');
		expect(declarations(utility).get('translate'), composable).toBe(tailwindTranslate);
	});

	it.each(['unplaced', 'top', 'bottom', 'right', 'left'])(
		'sets both axis variables for the %s arrow',
		(side) => {
			const body = side === 'unplaced' ? utility : blockBody(utility, `&[data-side='${side}'] {`);
			const own = declarations(body);

			expect(own.has('--tw-translate-x'), composable).toBe(true);
			expect(own.has('--tw-translate-y'), composable).toBe(true);
			expect(own.get('translate') ?? tailwindTranslate, composable).toBe(tailwindTranslate);
		}
	);
});
