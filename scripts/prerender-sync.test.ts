import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES } from '../src/lib/i18n/languages';

// These must stay in sync — if a language is added to languages.ts,
// svelte.config.js prerender entries must be updated too.
const SVELTE_CONFIG_LANGUAGES = ['en', 'de', 'es', 'fr'];

describe('prerender config sync', () => {
	it('svelte.config.js LANGUAGES matches canonical SUPPORTED_LANGUAGES', () => {
		const canonicalCodes = SUPPORTED_LANGUAGES.map((l) => l.code).sort();
		const configCodes = [...SVELTE_CONFIG_LANGUAGES].sort();

		expect(configCodes).toEqual(canonicalCodes);
	});
});
