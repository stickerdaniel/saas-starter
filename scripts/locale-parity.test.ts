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

// Key names never contain literal dots; nesting is the only structure.
// A dotted key name means a parent/child collision in Tolgee (a key that is
// both a string leaf and a namespace prefix), which forces the exporter into
// a flat-dotted fallback and splits one logical key across two shapes.
function dottedKeyNames(value: unknown, prefix = ''): string[] {
	if (value === null || typeof value !== 'object') return [];
	return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
		const path = prefix ? `${prefix}.${key}` : key;
		const own = key.includes('.') ? [path] : [];
		return [...own, ...dottedKeyNames(child, path)];
	});
}

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

describe('locale key structure', () => {
	it.each(['en', 'de', 'es', 'fr'])('%s.json has no dotted key names', (lang) => {
		const locale = { en, ...otherLocales }[lang as 'en' | 'de' | 'es' | 'fr'];
		expect(dottedKeyNames(locale)).toEqual([]);
	});
});
