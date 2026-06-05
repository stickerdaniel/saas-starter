import { describe, expect, it } from 'vitest';
import en from '../src/i18n/en.json';
import de from '../src/i18n/de.json';
import es from '../src/i18n/es.json';
import fr from '../src/i18n/fr.json';

// All locale files must declare the same leaf key set — a key that exists in
// only one language silently renders as undefined in the others at runtime.
function leafKeys(value: unknown, prefix = ''): string[] {
	if (value === null || typeof value !== 'object') return [prefix];
	return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
		leafKeys(child, prefix ? `${prefix}.${key}` : key)
	);
}

const otherLocales = { de, es, fr };

describe('locale key parity', () => {
	const enKeys = leafKeys(en).sort();

	it('en.json has leaf keys', () => {
		expect(enKeys.length).toBeGreaterThan(0);
	});

	it.each(Object.keys(otherLocales))('%s.json has the same leaf keys as en.json', (lang) => {
		const keys = leafKeys(otherLocales[lang as keyof typeof otherLocales]).sort();
		expect(keys).toEqual(enKeys);
	});
});
