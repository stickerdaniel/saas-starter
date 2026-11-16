import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postcss from 'postcss';
import subsetFont from 'subset-font';
import type criticalFonts from 'virtual:marketing-fonts/server';
import { createBuilder } from 'vite';
import { describe, expect, it } from 'vitest';
import en from '../src/i18n/en.json';
import {
	OUTFIT_FONT,
	criticalFont,
	marketingFontCharacters,
	marketingFonts,
	publicFontCharacters
} from './marketing-fonts';

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

	it('names the served Outfit file after its bytes, so its immutable URL changes with them', async () => {
		const digest = createHash('sha256')
			.update(await readFile(OUTFIT_FONT))
			.digest('hex');
		expect(
			path.basename(fileURLToPath(OUTFIT_FONT)),
			'Fontless names the cached font asset after its source path. Rename the file to end with the first 8 hex digits of its SHA-256 whenever its bytes change.'
		).toMatch(new RegExp(`\\.${digest.slice(0, 8)}\\.woff2$`));
	});

	it('embeds a WOFF2 subset registered for regular through bold', async () => {
		const original = await readFile(OUTFIT_FONT);
		const { css, href } = await criticalFont(original, 'Ship faster.');
		const registeredWeights = new Set<number>();
		postcss.parse(css).walkAtRules('font-face', (rule) => {
			rule.walkDecls('font-weight', ({ value }) => {
				const [minimum, maximum = minimum] = value.split(/\s+/).map(Number);
				for (const weight of [400, 500, 600, 700]) {
					if (weight >= minimum! && weight <= maximum!) registeredWeights.add(weight);
				}
			});
		});
		expect(
			registeredWeights,
			'Outfit registers regular through bold from OUTFIT_WEIGHTS, which both Fontless and the critical face read, so public headings use real outlines.'
		).toEqual(new Set([400, 500, 600, 700]));
		const encoded = /data:font\/woff2;base64,([A-Za-z0-9+/=]+)/.exec(css)?.[1];
		expect(encoded).toBeDefined();
		expect(href).toBe(`data:font/woff2;base64,${encoded}`);
		const subset = Buffer.from(encoded!, 'base64');
		expect(subset.subarray(0, 4).toString()).toBe('wOF2');
		expect(subset.length).toBeLessThan(original.length);
	});
});

describe('critical font module', () => {
	it('bundles variable-weight subsets into the server build and rejects client imports', async () => {
		const root = await mkdtemp(path.join(tmpdir(), 'marketing-fonts-'));
		try {
			await mkdir(path.join(root, 'src/lib/content/legal'), { recursive: true });
			await writeFile(path.join(root, 'src/lib/content/legal/terms.md'), 'Terms');
			await writeFile(
				path.join(root, 'entry.js'),
				"export { default } from 'virtual:marketing-fonts/server';\n"
			);
			const builder = await createBuilder(
				{
					root,
					configFile: false,
					logLevel: 'silent',
					plugins: [marketingFonts()],
					build: { minify: false, sourcemap: false },
					environments: {
						ssr: { build: { outDir: 'server', rollupOptions: { input: 'entry.js' } } },
						client: { build: { outDir: 'client', rollupOptions: { input: 'entry.js' } } }
					}
				},
				false
			);
			await builder.build(builder.environments.ssr!);
			const [entry] = (await readdir(path.join(root, 'server'))).filter((file) =>
				file.startsWith('entry.')
			);
			const { default: fonts } = (await import(
				pathToFileURL(path.join(root, 'server', entry!)).href
			)) as { default: typeof criticalFonts };
			expect(fonts?.home.css).toContain('font-family:"Outfit Critical"');
			expect(fonts?.public.css).toContain('font-family:Outfit;');
			for (const { href } of [fonts!.home, fonts!.public]) {
				const subset = Buffer.from(href.replace('data:font/woff2;base64,', ''), 'base64');
				// Pinning fails on a font without a weight axis.
				const [regular, bold] = await Promise.all(
					[400, 700].map((wght) =>
						subsetFont(subset, 'S', { targetFormat: 'sfnt', variationAxes: { wght } }).catch(
							() => null
						)
					)
				);
				expect(
					Boolean(regular && bold && !regular.equals(bold)),
					'The critical faces subset OUTFIT_FONT, the variable file Fontless serves, so 400 and 700 render distinct outlines.'
				).toBe(true);
			}

			await expect(builder.build(builder.environments.client!)).rejects.toThrow('server-only');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);
});
