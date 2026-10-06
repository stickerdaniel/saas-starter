import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import en from '../src/i18n/en.json';
import { criticalFont, marketingFontCharacters, publicFontCharacters } from './marketing-fonts';

describe('critical marketing fonts', () => {
	it('covers nested public translations, legal copy and typed ASCII', () => {
		const glyphs = publicFontCharacters([{ nested: { message: 'Piñata €' } }, '§ Legal™']);
		for (const character of 'ñ€§™!09AZaz~') expect(glyphs).toContain(character);
		expect(new Set(glyphs).size).toBe(glyphs.length);
	});

	it('includes authored copy changes, translated controls and the brand automatically', () => {
		const changed = {
			...en,
			hero: { ...en.hero, tagline: 'Piñata' },
			nav: { ...en.nav, home: 'Übersicht' },
			search: {
				...en.search,
				command: { ...en.search.command, trigger_desktop: 'Rechercher…' }
			}
		};
		const glyphs = marketingFontCharacters([changed], 'Crème™');
		for (const character of 'ñÜ…è™') expect(glyphs).toContain(character);
		for (const label of [en.hero.cta, en.hero.cta_demo, en.nav.dashboard]) {
			for (const character of label) expect(glyphs).toContain(character);
		}
		expect(new Set(glyphs).size).toBe(glyphs.length);
		expect(marketingFontCharacters([changed, changed], 'Crème™')).toBe(glyphs);
	});

	it('embeds a usable WOFF2 subset instead of a network font reference', async () => {
		const original = await readFile(
			fileURLToPath(new URL('../static/fonts/outfit-v15-latin-regular.woff2', import.meta.url))
		);
		const { css, href } = await criticalFont(original, 'Ship faster.');
		const encoded = /data:font\/woff2;base64,([A-Za-z0-9+/=]+)/.exec(css)?.[1];
		expect(encoded).toBeDefined();
		expect(href).toBe(`data:font/woff2;base64,${encoded}`);
		const subset = Buffer.from(encoded!, 'base64');
		expect(subset.subarray(0, 4).toString()).toBe('wOF2');
		expect(subset.length).toBeLessThan(original.length);
	});
});
