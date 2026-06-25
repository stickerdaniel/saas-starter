import { describe, expect, it } from 'vitest';
import { LEGAL_CONFIG } from '$lib/config/legal';
import en from '../../i18n/en.json';
import de from '../../i18n/de.json';
import es from '../../i18n/es.json';
import fr from '../../i18n/fr.json';

// SEOHead.svelte renders `<title>{title} | {brandName}</title>`, so every
// meta.*.title must be page-name only. A title that already ends in the brand
// renders it twice (e.g. "Pricing | Brand | Brand"). Guard the i18n side here
// so the duplication cannot ship regardless of where a title is edited.
const locales: Record<string, unknown> = { en, de, es, fr };
const suffix = ` | ${LEGAL_CONFIG.brandName}`;

describe('SEO meta titles never include the brand suffix', () => {
	for (const [lang, data] of Object.entries(locales)) {
		const meta = (data as { meta?: Record<string, { title?: unknown }> }).meta ?? {};
		for (const [page, entry] of Object.entries(meta)) {
			const title = entry?.title;
			if (typeof title !== 'string') continue;
			it(`${lang} meta.${page}.title`, () => {
				expect(
					title.includes(suffix),
					`"${title}" must be page-name only; SEOHead appends "${suffix}"`
				).toBe(false);
			});
		}
	}
});
