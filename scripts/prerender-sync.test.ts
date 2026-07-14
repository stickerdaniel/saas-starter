import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	assertLocaleFiles,
	renderLanguageCodes,
	renderStaticTranslations,
	renderWranglerConfig
} from './sync-locales';

describe('locale-derived configuration', () => {
	it('has exactly one translation file per configured locale', async () => {
		await expect(assertLocaleFiles()).resolves.toBeUndefined();
	});

	it('keeps the Node-compatible language-code registry generated', () => {
		const generated = fs.readFileSync(
			path.resolve('src/lib/i18n/language-codes.generated.js'),
			'utf8'
		);
		expect(generated).toBe(renderLanguageCodes());
	});

	it('keeps the shared static translation registry generated', () => {
		const generated = fs.readFileSync(
			path.resolve('src/lib/i18n/static-translations.generated.ts'),
			'utf8'
		);
		expect(generated).toBe(renderStaticTranslations());
	});

	it('keeps Cloudflare negotiated routes generated', () => {
		const wrangler = fs.readFileSync(path.resolve('wrangler.toml'), 'utf8');
		expect(wrangler).toBe(renderWranglerConfig(wrangler));
	});

	it('loads the Svelte config in Node without a TypeScript loader', () => {
		expect(() =>
			execFileSync(
				'node',
				['--input-type=module', '--eval', "await import('./svelte.config.js'); process.exit(0)"],
				{
					cwd: path.resolve('.'),
					stdio: 'pipe'
				}
			)
		).not.toThrow();
	});
});
