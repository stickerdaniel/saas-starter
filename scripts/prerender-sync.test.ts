import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES } from '../src/lib/i18n/languages';
import { SUPPORTED_LOCALES } from '../src/lib/convex/i18n/translations';

// These must stay in sync — if a language is added to languages.ts,
// svelte.config.js prerender entries must be updated too.
const SVELTE_CONFIG_LANGUAGES = ['en', 'de', 'es', 'fr'];

// Tolgee translation imports in +layout.svelte (hardcoded, must match canonical list)
const TOLGEE_IMPORT_LANGUAGES = ['en', 'de', 'es', 'fr'];

describe('language sync', () => {
	const canonicalCodes = SUPPORTED_LANGUAGES.map((l) => l.code).sort();

	it('svelte.config.js LANGUAGES matches canonical SUPPORTED_LANGUAGES', () => {
		expect([...SVELTE_CONFIG_LANGUAGES].sort()).toEqual(canonicalCodes);
	});

	it('Convex SUPPORTED_LOCALES matches canonical SUPPORTED_LANGUAGES', () => {
		expect([...SUPPORTED_LOCALES].sort()).toEqual(canonicalCodes);
	});

	it('Tolgee translation imports match canonical SUPPORTED_LANGUAGES', () => {
		expect([...TOLGEE_IMPORT_LANGUAGES].sort()).toEqual(canonicalCodes);
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
