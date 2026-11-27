// @vitest-environment node

import { createRequire } from 'node:module';
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import LegalMarkdown from '#lib/components/legal-markdown.svelte';
import { formatPostalAddress, getLegalEmailAddress, LEGAL_CONFIG } from '#lib/config/legal.js';
import { PUBLIC_MARKETING_ROUTES } from '#lib/marketing/public-routes.js';
import { aboutDocument } from './about';
import { contactDocument } from './contact';
import { impressumDocument } from './impressum';
import { LEGAL_CONTENT_DATES } from './legal-content-dates';
import { formatLegalContentDate } from './legal-metadata';
import type { LegalDocument } from './legal-template';
import { privacyDocument } from './privacy';
import { termsDocument } from './terms';

vi.mock('$app/state', () => ({ page: { params: { lang: 'en' } } }));

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
	JSDOM: new (html?: string) => { window: { document: Document } };
};

const legalDocuments = {
	privacyDocument,
	termsDocument,
	impressumDocument,
	aboutDocument,
	contactDocument
};

function parse(content: LegalDocument): Document {
	const { body } = render(LegalMarkdown, { props: { content } });
	return new JSDOM(body).window.document;
}

function literalTexts(content: LegalDocument): string[] {
	return [...parse(content).querySelectorAll('.legal-literal')].map(
		(element) => element.textContent
	);
}

function heading(content: LegalDocument): string | null | undefined {
	return parse(content).querySelector('h1')?.textContent;
}

function localizedLinks(content: LegalDocument): string[] {
	return [...parse(content).querySelectorAll('a[href^="/en/"]')].map((link) =>
		link.getAttribute('href')!.slice('/en'.length)
	);
}

describe('authored legal content', () => {
	it('renders configured identity and authored dates as literal text', () => {
		const lastUpdated = (date: keyof typeof LEGAL_CONTENT_DATES) =>
			formatLegalContentDate(LEGAL_CONTENT_DATES[date]);

		expect(heading(privacyDocument)).toBe('Privacy Policy');
		expect(new Set(literalTexts(privacyDocument))).toEqual(
			new Set([LEGAL_CONFIG.brandName, lastUpdated('privacy'), LEGAL_CONFIG.operatorName])
		);

		expect(heading(termsDocument)).toBe('Terms of Service');
		expect(new Set(literalTexts(termsDocument))).toEqual(
			new Set([LEGAL_CONFIG.brandName, lastUpdated('terms'), LEGAL_CONFIG.operatorName])
		);
		expect(localizedLinks(termsDocument)).toContain('/privacy');

		expect(heading(impressumDocument)).toBe('Impressum');
		expect(new Set(literalTexts(impressumDocument))).toEqual(
			new Set([
				formatPostalAddress(LEGAL_CONFIG.address),
				lastUpdated('impressum'),
				LEGAL_CONFIG.operatorName
			])
		);

		expect(heading(aboutDocument)).toBe(`About ${LEGAL_CONFIG.brandName}`);
		expect(new Set(literalTexts(aboutDocument))).toEqual(
			new Set([LEGAL_CONFIG.brandName, 'Daniel'])
		);

		expect(heading(contactDocument)).toBe('Contact');
		expect(localizedLinks(contactDocument)).toEqual(['/impressum']);
		expect(literalTexts(contactDocument)).toEqual([LEGAL_CONFIG.brandName]);
	});

	it.each(Object.entries(legalDocuments))(
		'keeps every localized link in %s on a public marketing route',
		(_name, document) => {
			const allowed = new Set<string>(PUBLIC_MARKETING_ROUTES.map((route) => route.pathSuffix));
			for (const link of localizedLinks(document)) {
				expect(allowed.has(link), `Unexpected relative link: ${link}`).toBe(true);
			}
		}
	);

	it('leaves contact addresses to the obfuscated page controls', () => {
		for (const document of Object.values(legalDocuments)) {
			expect(parse(document).body.innerHTML).not.toContain(getLegalEmailAddress());
		}
	});
});
