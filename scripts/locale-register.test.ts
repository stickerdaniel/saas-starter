import { describe, expect, it } from 'vitest';
import de from '../src/i18n/de.json';
import fr from '../src/i18n/fr.json';

// All copy in the locale files, page metadata included, addresses the user
// informally: du in German, tu in French. Formal address is the usual first
// instinct for both languages, so it is caught here.
const FORMAL = {
	// Capitalized Sie/Ihr/Ihnen. A sentence that means "they" is reworded too,
	// so the formal form never has to be told apart from it.
	de: /(?<!\p{L})(Sie|Ihr|Ihre|Ihrem|Ihren|Ihrer|Ihres|Ihnen)(?!\p{L})/u,
	// vous/votre/vos/veuillez, but not the noun "rendez-vous".
	// Imperative forms such as "Cliquez" are not pattern-checked.
	fr: /(?<!\p{L})(?<!rendez-)(vous|votre|vos|veuillez)(?!\p{L})/iu
};

function leaves(value: unknown, prefix = ''): Array<[string, string]> {
	if (typeof value === 'string') return [[prefix, value]];
	return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
		leaves(child, prefix ? `${prefix}.${key}` : key)
	);
}

describe('locale register', () => {
	it.each([
		['de', de, 'du/dein/dich'],
		['fr', fr, 'tu/ton/ta/tes and tu imperatives']
	] as const)('%s.json addresses the user informally', (lang, locale, informal) => {
		const formal = leaves(locale)
			.filter(([, text]) => FORMAL[lang].test(text))
			.map(([key, text]) => `${key}: ${text}`);

		expect(formal, `Use informal address (${informal}) in ${lang}.json`).toEqual([]);
	});
});
