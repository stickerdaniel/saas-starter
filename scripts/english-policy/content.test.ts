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

	it('checks source comments without scanning localized assertion strings', () => {
		const source = [
			`const localizedAssertion = ${JSON.stringify(foreignFixtures.german)};`,
			`// ${foreignFixtures.french}`
		].join('\n');
		expect(checkEnglishText('src/example.ts', source)).toMatchObject([{ language: 'fr', line: 2 }]);
	});

	it('checks Svelte markup comments', () => {
		const source = `<p>Localized product copy stays outside this scope.</p>\n<!-- ${foreignFixtures.german} -->`;
		expect(checkEnglishText('src/Example.svelte', source)).toMatchObject([
			{ language: 'de', line: 2 }
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
