import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { missingPrimitiveCandidates, scanStylesheet } from './test-fixtures/tailwind-scan';

const fixtures: string[] = [];
afterEach(() => {
	for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true });
});

describe('the primitives stylesheet', () => {
	it('adds every class of the primitives to an app whose sources hold none of them', async () => {
		const app = mkdtempSync(join(realpathSync(tmpdir()), 'ui-primitives-'));
		fixtures.push(app);
		mkdirSync(join(app, 'src'));
		const page = join(app, 'src/page.svelte');
		writeFileSync(page, '<p class="underline">Page</p>\n');
		const tailwind = createRequire(import.meta.url).resolve('tailwindcss/index.css');
		const entry = join(app, 'src/app.css');
		writeFileSync(
			entry,
			`@import '${tailwind}' source('.');\n@import '${join(import.meta.dirname, 'primitives.css')}';\n`
		);

		const scan = await scanStylesheet(entry);

		expect(scan.files).toContain(page);
		expect(scan.files).toContain(join(import.meta.dirname, 'card/card.svelte'));
		expect(missingPrimitiveCandidates(scan)).toEqual([]);
	});
});
