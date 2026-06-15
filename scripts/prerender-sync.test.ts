import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES } from '../src/lib/i18n/languages';
import { SUPPORTED_LOCALES } from '../src/lib/convex/i18n/translations';

describe('language sync', () => {
	const canonicalCodes = SUPPORTED_LANGUAGES.map((l) => l.code).sort();

	it('svelte.config.js LANGUAGES matches canonical SUPPORTED_LANGUAGES', () => {
		const content = fs.readFileSync(path.resolve('svelte.config.js'), 'utf-8');
		const arrayMatch = content.match(/const LANGUAGES\s*=\s*\[([^\]]*)\]/);
		// Fail loudly if svelte.config.js is restructured, instead of passing vacuously
		expect(arrayMatch, 'LANGUAGES array not found in svelte.config.js').not.toBeNull();

		const entries = [...arrayMatch![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!).sort();
		expect(entries).toEqual(canonicalCodes);
	});

	it('Convex SUPPORTED_LOCALES matches canonical SUPPORTED_LANGUAGES', () => {
		expect([...SUPPORTED_LOCALES].sort()).toEqual(canonicalCodes);
	});

	it('Tolgee translation staticData in +layout.svelte matches canonical SUPPORTED_LANGUAGES', () => {
		const content = fs.readFileSync(path.resolve('src/routes/+layout.svelte'), 'utf-8');
		const staticDataMatch = content.match(
			/const translations:\s*TolgeeStaticData\s*=\s*\{([^}]*)\}/
		);
		// Fail loudly if the staticData block is renamed/restructured, instead of passing vacuously
		expect(
			staticDataMatch,
			'translations staticData object not found in +layout.svelte'
		).not.toBeNull();

		const keys = [...staticDataMatch![1]!.matchAll(/([A-Za-z]+)/g)].map((m) => m[1]!).sort();
		expect(keys).toEqual(canonicalCodes);
	});

	it('wrangler.toml run_worker_first matches canonical SUPPORTED_LANGUAGES', () => {
		const content = fs.readFileSync(path.resolve('wrangler.toml'), 'utf-8');
		const arrayMatch = content.match(/run_worker_first\s*=\s*\[([^\]]*)\]/);
		// Fail loudly if wrangler.toml is restructured, instead of passing vacuously
		expect(arrayMatch, 'run_worker_first array not found in wrangler.toml').not.toBeNull();

		const entries = [...arrayMatch![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).sort();
		// Each language needs both the bare prefix and the wildcard so markdown
		// content negotiation covers /<lang> and every marketing page under it.
		const expectedEntries = canonicalCodes.flatMap((code) => [`/${code}`, `/${code}/*`]).sort();
		expect(entries).toEqual(expectedEntries);
	});
});
