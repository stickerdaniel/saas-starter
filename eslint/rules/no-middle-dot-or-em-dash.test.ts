// @vitest-environment node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { withoutTypeInformation } from '../without-type-information';

/**
 * Every case goes through the real config with a real path, so the assertions
 * cover the file selection in eslint.config.js as well as the rule. The banned
 * characters are built from their code points, which keeps this guard free of
 * the text it bans.
 */
const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const eslint = new ESLint({ cwd: repoRoot, overrideConfig: withoutTypeInformation });
const ruleId = 'local/no-middle-dot-or-em-dash';
const DOT = String.fromCharCode(0x00b7);
const DASH = String.fromCharCode(0x2014);

async function reports(source: string, filePath: string) {
	const [result] = await eslint.lintText(source, { filePath });
	expect(result.messages.filter((message) => message.fatal)).toEqual([]);
	return result.messages.filter((message) => message.ruleId === ruleId);
}

describe('no-middle-dot-or-em-dash', () => {
	it.each([
		['a string literal', `export const title = 'Pro ${DOT} monthly';`],
		['a template literal part', `export const line = (a: string) => \`\${a} ${DASH} done\`;`],
		['an escape, which ships the same character', "export const title = 'Pro \\u00b7 monthly';"],
		['an escaped template part', 'export const line = `Pro \\u2014 monthly`;']
	])('flags %s in shipped TypeScript', async (_label, source) => {
		const found = await reports(source, 'src/lib/convex/example.ts');
		expect(found).toHaveLength(1);
		expect(found[0]!.message).toContain('use a comma, colon, line break or spacing');
	});

	it.each([
		['template text', `<p>Support ${DOT} now</p>`],
		['an attribute value', `<input placeholder="Draft ${DASH} ready" />`],
		['a string inside an expression', `<p>{['a', 'b'].join(' ${DOT} ')}</p>`]
	])('flags %s in a Svelte component', async (_label, source) => {
		expect(await reports(source, 'src/lib/components/example.svelte')).toHaveLength(1);
	});

	// Comments and CSS never reach a user, and a regular expression that finds or
	// strips the characters is code rather than text.
	it.each([
		['a line comment', `// a ${DASH} b\nexport {};`, 'src/lib/example.ts'],
		['a block comment', `/* a ${DOT} b */\nexport {};`, 'src/lib/example.ts'],
		['a regular expression', `export const strip = /[${DOT}${DASH}]/u;`, 'src/lib/example.ts'],
		['an HTML comment', `<!-- a ${DASH} b --><p>ok</p>`, 'src/lib/example.svelte'],
		[
			'a style block',
			`<p>ok</p><style>/* a ${DASH} b */ p { color: red; }</style>`,
			'src/lib/example.svelte'
		]
	])('leaves %s alone', async (_label, source, filePath) => {
		expect(await reports(source, filePath)).toEqual([]);
	});

	// Tests and fixtures record text in its source form, and an en dash or a
	// hyphen is a different character.
	it.each([
		['a unit test', `export const x = 'a ${DOT} b';`, 'src/lib/example.test.ts'],
		['a test fixture', `export const x = 'a ${DASH} b';`, 'src/lib/__fixtures__/example.ts'],
		['an en dash', `export const x = 'a ${String.fromCharCode(0x2013)} b';`, 'src/lib/example.ts'],
		['a build script', `export const x = 'a ${DASH} b';`, 'scripts/example.ts']
	])('leaves %s alone', async (_label, source, filePath) => {
		expect(await reports(source, filePath)).toEqual([]);
	});

	it('accepts a disable comment for data that mirrors recorded content', async () => {
		const source = [
			'// eslint-disable-next-line local/no-middle-dot-or-em-dash -- copied from a provider response',
			`export const recorded = 'Engineer ${DOT} Acme';`
		].join('\n');
		expect(await reports(source, 'src/lib/example.ts')).toEqual([]);
	});
});
