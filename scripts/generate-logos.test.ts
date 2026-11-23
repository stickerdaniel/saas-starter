import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderLogoAssets } from './generate-logos';

const STATIC_DIR = join(import.meta.dirname, '../static');

describe('committed logo assets', () => {
	const assets = renderLogoAssets(readFileSync(join(STATIC_DIR, 'logo.svg'), 'utf-8'));

	it.each([...assets])('static/%s is what static/logo.svg renders to', (file, rendered) => {
		const committed = readFileSync(join(STATIC_DIR, file));
		expect(
			committed.equals(Buffer.from(rendered)),
			'Run `bun run generate:logos` and commit the result'
		).toBe(true);
	});
});

describe('renderLogoAssets', () => {
	it('renders a comma-separated viewBox like the committed space-separated one', () => {
		const source = readFileSync(join(STATIC_DIR, 'logo.svg'), 'utf-8').replace(
			/viewBox="([^"]+)"/,
			(_match, viewBox: string) => `viewBox="${viewBox.trim().split(/\s+/).join(',')}"`
		);
		expect(source).toMatch(/viewBox="[^" ]+,[^" ]+"/);
		for (const [file, rendered] of renderLogoAssets(source)) {
			if (Buffer.isBuffer(rendered)) {
				expect(readFileSync(join(STATIC_DIR, file)).equals(rendered), file).toBe(true);
			}
		}
	});
});
