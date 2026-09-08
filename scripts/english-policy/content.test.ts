import { describe, expect, it } from 'vitest';
import { checkEnglishText, isEnglishPolicyFile, proseWindows } from './content';

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
		expect(checkEnglishText('docs/example.md', markdown)).toEqual([]);
	});

	it('still finds adjacent foreign prose without a locale label', () => {
		const markdown = [`- **de**: "${foreignFixtures.german}"`, foreignFixtures.french].join('\n');
		expect(checkEnglishText('docs/example.md', markdown)).toMatchObject([
			{ language: 'fr', line: 2 }
		]);
	});

	it('recurses through every English locale string leaf', () => {
		const englishLocale = JSON.stringify({
			heading: 'Account security',
			nested: { message: foreignFixtures.spanish },
			items: ['Reset password', foreignFixtures.german]
		});
		expect(checkEnglishText('src/i18n/en.json', englishLocale)).toMatchObject([
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
		expect(checkEnglishText('src/example.ts', source)).toMatchObject([
			{ language: 'fr', line: 2 },
			{ language: 'es', line: 4 }
		]);
	});

	it('groups only directly consecutive line comments', () => {
		const joined = '// Das Passwort muss\n// sofort zurückgesetzt werden.';
		const separated = '// Das Passwort muss\n\n// sofort zurückgesetzt werden.';
		const interrupted =
			'// Das Passwort muss\nconst ready = true;\n// sofort zurückgesetzt werden.';
		expect(checkEnglishText('src/example.ts', joined)).toMatchObject([{ language: 'de', line: 1 }]);
		expect(proseWindows('src/example.ts', separated)).toHaveLength(2);
		expect(proseWindows('src/example.ts', interrupted)).toHaveLength(2);
	});

	it('finds a clear foreign source-comment subject after an acronym', () => {
		expect(checkEnglishText('src/example.ts', '// API aktualisieren')).toMatchObject([
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
		expect(checkEnglishText('src/example.ts', source)).toMatchObject([
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
		expect(checkEnglishText('src/Example.svelte', source)).toMatchObject([
			{ language: 'fr', line: 2 },
			{ language: 'de', line: 5 },
			{ language: 'es', line: 8 }
		]);
	});

	it('checks prose inside Markdown comments', () => {
		expect(checkEnglishText('docs/example.md', `<!-- ${foreignFixtures.german} -->`)).toMatchObject(
			[{ language: 'de', line: 1 }]
		);
	});

	it('checks JSON descriptions without scanning other localized values', () => {
		const config = JSON.stringify({
			description: foreignFixtures.german,
			localizedAssertion: foreignFixtures.french
		});
		expect(checkEnglishText('config.json', config)).toMatchObject([{ language: 'de' }]);
	});

	it('exempts only registered target locale files', () => {
		expect(isEnglishPolicyFile('src/i18n/en.json')).toBe(true);
		expect(isEnglishPolicyFile('src/i18n/de.json')).toBe(false);
		expect(isEnglishPolicyFile('src/i18n/es.json')).toBe(false);
		expect(isEnglishPolicyFile('src/i18n/fr.json')).toBe(false);
		expect(isEnglishPolicyFile('src/i18n/it.json')).toBe(true);
	});

	it.each(['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'svelte'])(
		'checks .%s source files',
		(extension) => {
			expect(isEnglishPolicyFile(`src/example.${extension}`)).toBe(true);
		}
	);

	it('exempts only the generated pull request metadata bundle', () => {
		expect(isEnglishPolicyFile('scripts/english-policy/pr-metadata.bundle.mjs')).toBe(false);
		expect(isEnglishPolicyFile('scripts/example.bundle.mjs')).toBe(true);
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
		expect(checkEnglishText('docs/example.md', markdown)).toEqual([]);
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
		expect(proseWindows('docs/example.md', markdown).map((window) => window.text)).not.toContain(
			foreignFixtures.german
		);
		expect(checkEnglishText('docs/example.md', markdown)).toEqual([]);
	});
});
