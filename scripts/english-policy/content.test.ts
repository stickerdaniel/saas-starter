import { describe, expect, it } from 'vitest';
import { required } from '../required';
import {
	checkEnglishText,
	isEnglishPolicyFile,
	localeCatalogOf,
	proseKindForFile,
	proseWindows
} from './content';

const kindOf = (label: string) => required(proseKindForFile(label, undefined) ?? undefined, label);
const check = (label: string, text: string) => checkEnglishText(label, text, kindOf(label));
const windows = (label: string, text: string) => proseWindows(label, text, kindOf(label));

const foreignFixtures = {
	german: 'Das Passwort muss sofort zurückgesetzt werden.',
	french: 'Ceci est un texte français clairement rédigé.',
	spanish: 'Este texto está claramente escrito en español.'
} as const;

describe('repository prose extraction', () => {
	it('allows exact locale-labelled quotations in Markdown', () => {
		const markdown = [
			'Translation examples:',
			`- **de**: "${foreignFixtures.german}"`,
			`- **fr**: "${foreignFixtures.french}"`,
			`- **es**: "${foreignFixtures.spanish}"`
		].join('\n');
		expect(check('docs/example.md', markdown)).toEqual([]);
	});

	it('still finds adjacent foreign prose without a locale label', () => {
		const markdown = [`- **de**: "${foreignFixtures.german}"`, foreignFixtures.french].join('\n');
		expect(check('docs/example.md', markdown)).toMatchObject([{ language: 'fr', line: 2 }]);
	});

	it('recurses through every English locale string leaf', () => {
		const englishLocale = JSON.stringify({
			heading: 'Account security',
			nested: { message: foreignFixtures.spanish },
			items: ['Reset password', foreignFixtures.german]
		});
		expect(checkEnglishText('src/i18n/en.json', englishLocale, 'english-locale')).toMatchObject([
			{ language: 'es' },
			{ language: 'de' }
		]);
	});

	it('uses TypeScript comment ranges around templates and regular expressions', () => {
		const source = [
			`const localizedAssertion = \`${foreignFixtures.german}\`;`,
			`const marker = /[/][/]/u; // ${foreignFixtures.french}`,
			'const complete = true;',
			`/* ${foreignFixtures.spanish} */`
		].join('\n');
		expect(check('src/example.ts', source)).toMatchObject([
			{ language: 'fr', line: 2 },
			{ language: 'es', line: 4 }
		]);
	});

	it('groups only directly consecutive line comments', () => {
		const joined = '// Das Passwort muss\n// sofort zurückgesetzt werden.';
		const separated = '// Das Passwort muss\n\n// sofort zurückgesetzt werden.';
		const interrupted =
			'// Das Passwort muss\nconst ready = true;\n// sofort zurückgesetzt werden.';
		expect(check('src/example.ts', joined)).toMatchObject([{ language: 'de', line: 1 }]);
		expect(windows('src/example.ts', separated)).toHaveLength(2);
		expect(windows('src/example.ts', interrupted)).toHaveLength(2);
	});

	it('reports prose in multiline TypeScript comments on its source line', () => {
		const docComment = ['const ready = true;', '/**', ` * ${foreignFixtures.german}`, ' */'].join(
			'\n'
		);
		const wrappedBlock = [
			'/**',
			' * This updates authentication while',
			' * das Passwort sofort zurückgesetzt werden muss.',
			' */'
		].join('\n');
		const wrappedLines = [
			'// This updates authentication while',
			'// das Passwort sofort zurückgesetzt werden muss.'
		].join('\n');
		expect(check('src/example.ts', docComment)).toMatchObject([{ language: 'de', line: 3 }]);
		expect(check('src/example.ts', wrappedBlock).map((finding) => finding.line)).toContain(3);
		expect(check('src/example.ts', wrappedLines).map((finding) => finding.line)).toContain(2);
	});

	it('skips inline code that wraps across grouped line comments', () => {
		const source = [
			'// Example: `Das Passwort muss',
			'// sofort zurückgesetzt werden` stays a fixture.'
		].join('\n');
		expect(check('src/example.ts', source)).toEqual([]);
	});

	it('finds foreign prose after a blank comment line ends an unclosed code span', () => {
		const source = ['// Example: `unclosed', '//', `// ${foreignFixtures.german}\``].join('\n');
		expect(check('src/example.ts', source)).toMatchObject([{ language: 'de', line: 3 }]);
	});

	it('skips inline code that wraps across Markdown prose lines', () => {
		const markdown = [
			'Use the fixture `Das Passwort muss',
			'sofort zurückgesetzt werden` in examples.'
		].join('\n');
		expect(check('docs/example.md', markdown)).toEqual([]);
	});

	it('finds a clear foreign source-comment subject after an acronym', () => {
		expect(check('src/example.ts', '// API aktualisieren')).toMatchObject([
			{ language: 'de', line: 1 }
		]);
	});

	it('preserves uppercase prose with technical-looking suffixes in source comments', () => {
		const source = [
			'// PASSWORT ZURUECKSETZEN',
			'const first = true;',
			'// PASSWORT1 ZURUECKSETZEN1',
			'const second = true;',
			'// PASSWORT_1 ZURUECKSETZEN_1',
			'const third = true;',
			'/* ESTE TEXTO ESTA CLARAMENTE ESCRITO EN ESPANOL */'
		].join('\n');
		expect(check('src/example.ts', source)).toMatchObject([
			{ language: 'de', line: 1 },
			{ language: 'de', line: 3 },
			{ language: 'de', line: 5 },
			{ language: 'es', line: 7 }
		]);
	});

	it('checks Svelte script, markup, and CSS parser comments', () => {
		const source = [
			'<script lang="ts">',
			`const marker: RegExp = /[/][/]/u; // ${foreignFixtures.french}`,
			`const localized = \`${foreignFixtures.spanish}\`;`,
			'</script>',
			`<!-- ${foreignFixtures.german} -->`,
			'<style>',
			`.example { content: "/* ${foreignFixtures.spanish} */"; }`,
			`/* ${foreignFixtures.spanish} */`,
			'</style>'
		].join('\n');
		expect(check('src/Example.svelte', source)).toMatchObject([
			{ language: 'fr', line: 2 },
			{ language: 'de', line: 5 },
			{ language: 'es', line: 8 }
		]);
	});

	it('reads a style language the way the ESLint parser does', () => {
		// `c&#115;s` decodes to `css`, which svelte-eslint-parser does not recognize.
		const source = `<style lang="c&#115;s">/* ${foreignFixtures.german} */</style>`;
		expect(check('src/Example.svelte', source)).toEqual([]);
		expect(
			check('src/Example.svelte', `<style lang="css">/* ${foreignFixtures.german} */</style>`)
		).toMatchObject([{ language: 'de', line: 1 }]);
	});

	it('checks prose inside Markdown comments', () => {
		expect(check('docs/example.md', `<!-- ${foreignFixtures.german} -->`)).toMatchObject([
			{ language: 'de', line: 1 }
		]);
	});

	it('checks JSON descriptions without scanning other localized values', () => {
		const config = JSON.stringify({
			description: foreignFixtures.german,
			localizedAssertion: foreignFixtures.french
		});
		expect(check('config.json', config)).toMatchObject([{ language: 'de' }]);
	});

	it('exempts only the catalogs of registered target languages', () => {
		expect(isEnglishPolicyFile('en.json', localeCatalogOf('en'))).toBe(true);
		expect(isEnglishPolicyFile('de.json', localeCatalogOf('de'))).toBe(false);
		expect(isEnglishPolicyFile('es.json', localeCatalogOf('es'))).toBe(false);
		expect(isEnglishPolicyFile('fr.json', localeCatalogOf('fr'))).toBe(false);
		expect(isEnglishPolicyFile('it.json', localeCatalogOf('it'))).toBe(true);
	});

	it.each(['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'svelte'])(
		'checks .%s source files',
		(extension) => {
			expect(isEnglishPolicyFile(`src/example.${extension}`, undefined)).toBe(true);
		}
	);

	it('exempts only the generated pull request metadata bundle', () => {
		expect(isEnglishPolicyFile('scripts/english-policy/pr-metadata.bundle.mjs', undefined)).toBe(
			false
		);
		expect(isEnglishPolicyFile('scripts/example.bundle.mjs', undefined)).toBe(true);
	});

	it.each([
		['backtick', '````', '```'],
		['tilde', '~~~~', '~~~']
	])('keeps shorter %s fences nested inside code examples', (_label, outer, inner) => {
		const markdown = [
			'Use the example below.',
			'',
			`${outer}markdown`,
			inner,
			foreignFixtures.german,
			inner,
			outer,
			'',
			'Continue with the English explanation.'
		].join('\n');
		expect(check('docs/example.md', markdown)).toEqual([]);
	});

	it.each([
		['top-level', ['Console output:', '', `    ${foreignFixtures.german}`]],
		['after a heading', ['# Console output', `    ${foreignFixtures.german}`]],
		['inside a list item', ['- Console output:', '', `      ${foreignFixtures.german}`]],
		['inside a block quote', ['> Console output:', '>', `>     ${foreignFixtures.german}`]]
	])('skips %s indented code', (_label, lines) => {
		expect(check('docs/example.md', lines.join('\n'))).toEqual([]);
	});

	it('checks a list continuation paragraph on its source line', () => {
		const markdown = [
			'- Console output:',
			'',
			`      ${foreignFixtures.french}`,
			'',
			`  ${foreignFixtures.german}`
		].join('\n');
		expect(check('docs/example.md', markdown)).toMatchObject([{ language: 'de', line: 5 }]);
	});

	it('skips fenced code and inline technical syntax', () => {
		const markdown = [
			'Use the command below.',
			'',
			'```text',
			foreignFixtures.german,
			'```',
			'',
			'Run `bun scripts/check.ts` for https://example.test/report.'
		].join('\n');
		expect(windows('docs/example.md', markdown).map((window) => window.text)).not.toContain(
			foreignFixtures.german
		);
		expect(check('docs/example.md', markdown)).toEqual([]);
	});
});
