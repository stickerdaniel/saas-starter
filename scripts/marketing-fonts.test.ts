import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { createBuilder, type Plugin } from 'vite';
import { describe, expect, it } from 'vitest';
import en from '../src/i18n/en.json';
import {
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

	it('embeds a WOFF2 subset registered for regular through bold', async () => {
		const original = await readFile(
			fileURLToPath(new URL('../static/fonts/outfit-v15-latin-regular.woff2', import.meta.url))
		);
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
			'Critical font faces must register regular through bold so public headings use real outlines.'
		).toEqual(new Set([400, 500, 600, 700]));
		const encoded = /data:font\/woff2;base64,([A-Za-z0-9+/=]+)/.exec(css)?.[1];
		expect(encoded).toBeDefined();
		expect(href).toBe(`data:font/woff2;base64,${encoded}`);
		const subset = Buffer.from(encoded!, 'base64');
		expect(subset.subarray(0, 4).toString()).toBe('wOF2');
		expect(subset.length).toBeLessThan(original.length);
	});
});

describe('critical font publication', () => {
	it('publishes the subset after the client font exists and before the adapter copies it', async () => {
		const root = path.join(tmpdir(), `marketing-fonts-${process.pid}-${Date.now()}`);
		const clientDir = path.join(root, 'client');
		const fontFile = path.join(clientDir, 'outfit.woff2');
		const serverPackage = path.join(
			root,
			'server',
			'node_modules',
			'@saas-starter-internal',
			'marketing-fonts',
			'index.js'
		);
		const outfit = await readFile(
			fileURLToPath(new URL('../static/fonts/outfit-v15-latin-regular.woff2', import.meta.url))
		);
		let published = '';
		// Kit 3 builds SSR before any client output exists, then the adapter copies
		// the server directory. Publication has to survive that order.
		const kitBuild: Plugin = {
			name: 'kit-client-after-ssr',
			async buildApp(builder) {
				await rm(clientDir, { recursive: true, force: true });
				await builder.build(builder.environments.ssr!);
				await mkdir(path.dirname(fontFile), { recursive: true });
				await writeFile(fontFile, outfit);
				await mkdir(path.join(clientDir, 'assets'), { recursive: true });
				await writeFile(
					path.join(clientDir, 'assets', 'app.css'),
					'@font-face{font-family:"Outfit";src:url("../outfit.woff2") format("woff2");font-weight:400 700;}'
				);
			}
		};
		const adapter: Plugin = {
			name: 'adapter-copy',
			buildApp: {
				order: 'post',
				async handler() {
					published = await readFile(serverPackage, 'utf8');
				}
			}
		};
		try {
			await mkdir(path.join(root, 'src/lib/content/legal'), { recursive: true });
			await writeFile(path.join(root, 'entry.js'), 'export {};\n');
			await writeFile(path.join(root, 'src/lib/content/legal/terms.md'), 'Terms');
			const builder = await createBuilder(
				{
					root,
					configFile: false,
					logLevel: 'silent',
					plugins: [kitBuild, marketingFonts(), adapter],
					build: { minify: false, sourcemap: false, emptyOutDir: false },
					environments: {
						ssr: { build: { outDir: 'server', rollupOptions: { input: 'entry.js' } } },
						client: { build: { outDir: 'client', emptyOutDir: false } }
					}
				},
				false
			);
			await builder.buildApp();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
		expect(published).toContain('"home"');
		expect(published).toContain('"public"');
		expect(published).toContain('data:font/woff2;base64,');
	}, 30_000);
});
