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
