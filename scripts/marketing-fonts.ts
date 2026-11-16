import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import subsetFont from 'subset-font';
import type { Plugin, ResolvedConfig } from 'vite';
import type en from '../src/i18n/en.json';
import { LEGAL_CONFIG } from '../src/lib/config/legal';
import { STATIC_TRANSLATIONS } from '../src/lib/i18n/static-translations.generated';

const MODULE = 'virtual:marketing-fonts/server';

/**
 * The Outfit file Fontless serves and the critical faces subset, so the two cannot drift.
 * Source: https://fonts.gstatic.com/s/outfit/v15/QGYvz_MVcBeNP4NJtEtqUYLknw.woff2
 */
export const OUTFIT_FONT = new URL(
	'../src/lib/assets/fonts/outfit-v15-latin-wght.woff2',
	import.meta.url
);

/**
 * Outfit weights the UI authors. Fontless registers each one and the critical face spans
 * them, so a weight the variable font already contains renders its real outlines instead
 * of the nearest registered weight.
 */
export const OUTFIT_WEIGHTS = [400, 500, 600, 700] as const;
const OUTFIT_WEIGHT_SPAN = `${Math.min(...OUTFIT_WEIGHTS)} ${Math.max(...OUTFIT_WEIGHTS)}`;

/** Derive glyphs from authored copy, including every locale and header state. */
export function marketingFontCharacters(
	catalogs: ReadonlyArray<Pick<typeof en, 'hero' | 'nav' | 'search'>>,
	brand: string
): string {
	const strings: string[] = [brand, 'Ctrl', '⌘', 'K'];
	function collect(value: unknown) {
		if (typeof value === 'string') strings.push(value);
		else if (value && typeof value === 'object') Object.values(value).forEach(collect);
	}
	for (const catalog of catalogs) {
		collect(catalog.hero);
		collect(catalog.nav);
		collect(catalog.search.command);
	}
	return [...new Set(strings.join(''))].sort().join('');
}

/** Include public copy, legal templates and ordinary typed text in the initial font. */
export function publicFontCharacters(content: unknown): string {
	const strings = [
		Array.from({ length: 95 }, (_, index) => String.fromCharCode(index + 32)).join('')
	];
	function collect(value: unknown) {
		if (typeof value === 'string') strings.push(value);
		else if (value && typeof value === 'object') Object.values(value).forEach(collect);
	}
	collect(content);
	return [...new Set(strings.join(''))].sort().join('');
}

/** Keep the same outlines and OpenType layout features as the full font. */
export async function criticalFont(font: Buffer, characters: string) {
	const subset = await subsetFont(font, characters, { targetFormat: 'woff2' });
	const href = `data:font/woff2;base64,${subset.toString('base64')}`;
	const ranges = [...characters]
		.map((character) => `U+${character.codePointAt(0)!.toString(16)}`)
		.join(',');
	// These bytes are inline; wait for decoding rather than painting a fallback frame.
	const css =
		`@font-face{font-family:"Outfit Critical";font-style:normal;font-weight:${OUTFIT_WEIGHT_SPAN};` +
		'font-display:block;src:url("' +
		href +
		'") format("woff2");unicode-range:' +
		ranges +
		'}' +
		':root{--font-marketing-critical:"Outfit Critical",Outfit,"Outfit Fallback: Arial",ui-sans-serif,system-ui,sans-serif}';
	return { css, href };
}

/**
 * Bundle the critical faces into the server build as `virtual:marketing-fonts/server`.
 *
 * The module is server-only: its bytes reach the browser inline in HTML. In dev it
 * exports `null`, so pages load the full font Fontless serves.
 */
export function marketingFonts(): Plugin {
	let config: ResolvedConfig;
	return {
		name: 'marketing-fonts',
		configResolved(resolved) {
			config = resolved;
		},
		resolveId: {
			filter: { id: /^virtual:marketing-fonts\/server$/ },
			handler() {
				if (config.command === 'build' && (this.environment.name !== 'ssr' || config.isWorker)) {
					throw new Error(`${MODULE} is server-only; font bytes belong in HTML, not JavaScript.`);
				}
				return `\0${MODULE}`;
			}
		},
		load: {
			filter: { id: /^\0virtual:marketing-fonts\/server$/ },
			async handler() {
				if (config.command === 'serve') return 'export default null;';
				const font = await readFile(OUTFIT_FONT);
				const critical = await criticalFont(
					font,
					marketingFontCharacters(Object.values(STATIC_TRANSLATIONS), LEGAL_CONFIG.brandName)
				);
				const legalDirectory = path.join(config.root, 'src/lib/content/legal');
				const legalFiles = (await readdir(legalDirectory)).filter((file) => file.endsWith('.md'));
				const legal = await Promise.all(
					legalFiles.map((file) => readFile(path.join(legalDirectory, file), 'utf8'))
				);
				const publicCritical = await criticalFont(
					font,
					publicFontCharacters([STATIC_TRANSLATIONS, LEGAL_CONFIG, legal])
				);
				// Declared after Fontless's full face: covered glyphs use the inline font,
				// while the full face remains available for other text and languages.
				publicCritical.css = publicCritical.css
					.replace('font-family:"Outfit Critical"', 'font-family:Outfit')
					.replace('"Outfit Critical",Outfit,', 'Outfit,');
				return `export default ${JSON.stringify({ home: critical, public: publicCritical })};\n`;
			}
		}
	};
}
