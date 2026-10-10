import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import subsetFont from 'subset-font';
import type { Plugin, ResolvedConfig } from 'vite';
import type en from '../src/i18n/en.json';
import { LEGAL_CONFIG } from '../src/lib/config/legal';
import { STATIC_TRANSLATIONS } from '../src/lib/i18n/static-translations.generated';

const MODULE = 'virtual:marketing-fonts/server';
const PACKAGE = '@saas-starter-internal/marketing-fonts';

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

/** Use Fontless's emitted bytes so the subset and the rest of the page cannot drift. */
async function readEmittedOutfit(clientDir: string): Promise<Buffer> {
	const fonts = new Set<string>();
	const entries = await readdir(clientDir, { recursive: true });
	for (const entry of entries.filter((entry) => entry.endsWith('.css'))) {
		const css = postcss.parse(await readFile(path.join(clientDir, entry), 'utf8'));
		css.walkAtRules('font-face', (rule) => {
			const declarations = new Map<string, string>();
			rule.walkDecls((declaration) => {
				declarations.set(declaration.prop, declaration.value);
			});
			if (declarations.get('font-family')?.replaceAll(/["']/g, '') !== 'Outfit') return;
			const source = /url\(["']?([^"')]+)["']?\)/.exec(declarations.get('src') ?? '')?.[1];
			if (!source) throw new Error('Outfit must have a self-hosted font URL.');
			const url = new URL(source, `https://build.invalid/${entry.replaceAll('\\', '/')}`);
			fonts.add(path.join(clientDir, decodeURIComponent(url.pathname)));
		});
	}
	const [font] = fonts;
	if (fonts.size !== 1 || !font) {
		throw new Error(
			`Expected one shared Outfit font for weights ${OUTFIT_WEIGHT_SPAN.replace(' ', '–')}; found ${fonts.size}. Check the critical font configuration before changing the font family or faces.`
		);
	}
	return readFile(font);
}

/**
 * Publish the critical font after Kit's client build and before its adapter.
 *
 * Kit 3 bundles SSR first, so an SSR `writeBundle` runs while the client
 * output directory does not exist yet. This plugin is registered after
 * `sveltekit()`, and the adapter hook is ordered `post`, so `buildApp` sees
 * the font Fontless already wrote and lands the server package before the
 * adapter copies that output.
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
				if (config.command === 'serve') return `\0${MODULE}`;
				if (this.environment.name !== 'ssr' || config.isWorker) {
					throw new Error(`${MODULE} is server-only; font bytes belong in HTML, not JavaScript.`);
				}
				return { id: PACKAGE, external: true };
			}
		},
		load: {
			filter: { id: /^\0virtual:marketing-fonts\/server$/ },
			handler() {
				return 'export default null;';
			}
		},
		buildApp: {
			async handler(builder) {
				if (config.command !== 'build') return;
				const server = builder.environments.ssr;
				const client = builder.environments.client;
				if (!server || !client) {
					throw new Error(
						'marketing-fonts: Kit client and SSR environments are required to publish the critical font.'
					);
				}
				const serverDir = path.resolve(config.root, server.config.build.outDir);
				const clientDir = path.resolve(config.root, client.config.build.outDir);
				const font = await readEmittedOutfit(clientDir);
				const characters = marketingFontCharacters(
					Object.values(STATIC_TRANSLATIONS),
					LEGAL_CONFIG.brandName
				);
				const critical = await criticalFont(font, characters);
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
				const directory = path.join(serverDir, 'node_modules', ...PACKAGE.split('/'));
				await mkdir(directory, { recursive: true });
				await writeFile(
					path.join(directory, 'package.json'),
					JSON.stringify({ name: PACKAGE, private: true, type: 'module', exports: './index.js' })
				);
				await writeFile(
					path.join(directory, 'index.js'),
					`export default ${JSON.stringify({ home: critical, public: publicCritical })};\n`
				);
			}
		}
	};
}
