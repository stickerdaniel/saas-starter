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
});
