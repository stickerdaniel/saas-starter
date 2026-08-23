// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { ESLint } from 'eslint';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';

/**
 * What `no-literal-control-char` can actually see.
 *
 * The rule replaced a scan in `scripts/static-checks.ts` whose route required a
 * `src/` prefix, so it reached neither `scripts/` nor the config files nor itself.
 * That claim is the whole reason the rule lives in ESLint, and a config calculation
 * alone cannot prove it: a file-wide `/* eslint-disable *\/` still suppresses a rule
 * whose calculated severity is `error`.
 *
 * Each positive case therefore reads an existing tracked file, adds a control
 * character in a valid comment, and sends the result through the real ESLint API
 * with that file's path. This covers config selection, parsers, processors, inline
 * directives, and the final rule verdict in one assertion.
 *
 * Convex codegen and varlock's Convex generator write a file-wide disable into their
 * output, so those paths stay globally ignored. `src/env.d.ts` gets different
 * treatment: its processor blanks that directive without shifting source locations,
 * because environment values come from outside the repository and are exactly where
 * a character nobody typed can enter generated source.
 */
const eslint = new ESLint();
const offender = String.fromCharCode(0x1b);

async function controlCharacterMessages(file: string) {
	// Keep the real path, which selects the config, parser and processor. A minimal
	// source makes this a coverage test rather than a second lint of six whole files.
	// The generated env case deliberately keeps its real header, because its file-wide
	// disable is the condition the processor exists to remove.
	const source =
		file === 'src/env.d.ts'
			? readFileSync(file, 'utf-8')
			: file.endsWith('.svelte')
				? '<script>const value = true;</script>'
				: 'export {};';
	const withOffender = file.endsWith('.svelte')
		? `${source}\n<!-- ${offender} -->\n`
		: `${source}\n// ${offender}\n`;
	const [result] = await eslint.lintText(withOffender, { filePath: file });
	return result.messages.filter((message) => message.ruleId === 'local/no-literal-control-char');
}

describe('no-literal-control-char coverage', () => {
	it.each([
		['a source module', 'src/lib/utils.ts'],
		['a Svelte component', 'src/routes/+layout.svelte'],
		['a build script outside src/', 'scripts/static-checks.ts'],
		['the ESLint config itself', 'eslint.config.js'],
		['the rule implementation', 'eslint/rules/no-literal-control-char.js'],
		['the generated env types despite their file-wide disable', 'src/env.d.ts']
	])(
		'reaches %s',
		async (_label, file) => {
			expect(existsSync(file)).toBe(true);
			const messages = await controlCharacterMessages(file);
			expect(messages).toHaveLength(1);
			expect(messages[0].severity).toBe(2);
		},
		60_000
	);

	it.each([
		['C0', 0x1b, 'U+001B'],
		['DEL', 0x7f, 'U+007F'],
		['C1', 0x85, 'U+0085'],
		['bidi', 0x202e, 'U+202E']
	])(
		'sanitizes a fatal Svelte parser diagnostic carrying %s input',
		async (_label, code, codepoint) => {
			const value = String.fromCharCode(code);
			const source = `<div>{${value}}</div>`;
			const [result] = await eslint.lintText(source, { filePath: 'src/routes/+layout.svelte' });
			const fatal = result.messages.filter((message) => message.fatal);
			expect(fatal).toHaveLength(1);
			expect(fatal[0].message).toContain(codepoint);
			expect(fatal[0].message).not.toContain(value);
			const formatter = await eslint.loadFormatter('stylish');
			expect(stripAnsi(await formatter.format([result]))).not.toContain(value);
		},
		60_000
	);

	it('keeps ordinary Svelte rule suppression on the valid parse path', async () => {
		const source = `<!-- eslint-disable local/no-literal-control-char -->
<!-- ${offender} -->`;
		const [result] = await eslint.lintText(source, { filePath: 'src/routes/+layout.svelte' });
		expect(
			result.messages.filter((message) => message.ruleId === 'local/no-literal-control-char')
		).toEqual([]);
	}, 60_000);

	// The generators for these paths disable ESLint inside every file. Un-ignoring
	// them would buy no coverage and add only unused-directive warnings.
	it.each([
		['Convex codegen output', 'src/lib/convex/_generated/api.js'],
		['the varlock Convex env types', 'src/lib/convex/convex-env.d.ts']
	])(
		'leaves %s ignored, because its generator disables ESLint inside the file',
		async (_label, file) => {
			expect(await eslint.isPathIgnored(file)).toBe(true);
		}
	);
});
