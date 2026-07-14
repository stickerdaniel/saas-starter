import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertLocaleFiles, renderStaticTranslations, renderWranglerConfig } from './sync-locales';

describe('locale-derived configuration', () => {
	it('has exactly one translation file per configured locale', async () => {
		await expect(assertLocaleFiles()).resolves.toBeUndefined();
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
});
