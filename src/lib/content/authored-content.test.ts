import { describe, expect, it } from 'vitest';
import { formatPostalAddress, getLegalEmailAddress, LEGAL_CONFIG } from '#lib/config/legal.js';
import { PUBLIC_MARKETING_ROUTES } from '#lib/marketing/public-routes.js';
import { aboutMarkdown } from './about';
import { contactMarkdown, legalNoticeMarkdown } from './contact';
import { LEGAL_CONTENT_DATES, formatLegalContentDate } from './legal-metadata';
import { privacyMarkdown } from './privacy';
import { termsMarkdown } from './terms';

const legalDocuments = [
	privacyMarkdown,
	termsMarkdown,
	aboutMarkdown,
	contactMarkdown,
	legalNoticeMarkdown
];
// A sole proprietor leaves the company empty; About and Contact then name the operator.
const organizationName = LEGAL_CONFIG.companyName || LEGAL_CONFIG.operatorName;

function markdownDestinations(document: string): string[] {
	const inline = [
		...document.matchAll(/\[[^\]]*\]\(\s*(?:<([^>\s]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g)
	].map((match) => match[1] ?? match[2]!);
	const references = [
		...document.matchAll(/^\s{0,3}\[(?!\^)[^\]\r\n]+\]:\s*(?:<([^>\s]+)>|([^\s]+))/gm)
	].map((match) => match[1] ?? match[2]!);
	return [...inline, ...references];
}

describe('authored legal content', () => {
	it('keeps configured identity and authored dates in literal side tables', () => {
		expect(privacyMarkdown.markdown).toContain('# Privacy Policy');
		expect(privacyMarkdown.markdown).toContain('{{BRAND_NAME}}');
		expect(privacyMarkdown.markdown).toContain('{{OPERATOR_NAME}}');
		expect(privacyMarkdown.markdown).toContain('{{LAST_UPDATED}}');
		expect(privacyMarkdown.literals).toEqual({
			BRAND_NAME: LEGAL_CONFIG.brandName,
			LAST_UPDATED: formatLegalContentDate(LEGAL_CONTENT_DATES.privacy),
			OPERATOR_NAME: LEGAL_CONFIG.operatorName
		});

		expect(termsMarkdown.markdown).toContain('# Terms of Service');
		expect(termsMarkdown.markdown).toContain('{{BRAND_NAME}}');
		expect(termsMarkdown.markdown).toContain('[Privacy Policy](privacy)');
		expect(termsMarkdown.literals).toEqual({
			BRAND_NAME: LEGAL_CONFIG.brandName,
			LAST_UPDATED: formatLegalContentDate(LEGAL_CONTENT_DATES.terms),
			OPERATOR_NAME: LEGAL_CONFIG.operatorName
		});

		expect(aboutMarkdown.markdown).toContain('# About {{BRAND_NAME}}');
		expect(aboutMarkdown.markdown).toContain('[Contact](contact)');
		expect(aboutMarkdown.markdown).toContain('[legal notice](contact#legal-notice)');
		expect(aboutMarkdown.literals).toEqual({
			BRAND_NAME: LEGAL_CONFIG.brandName,
			OPERATOR_NAME: LEGAL_CONFIG.operatorName
		});

		expect(contactMarkdown.markdown).toContain('# Contact');
		expect(contactMarkdown.literals).toEqual({ BRAND_NAME: LEGAL_CONFIG.brandName });

		expect(legalNoticeMarkdown.markdown).toContain('## Legal notice');
		expect(legalNoticeMarkdown.markdown).toContain('Operated by {{OPERATOR_NAME}}');
		expect(legalNoticeMarkdown.markdown).toContain('{{ADDRESS}}');
		expect(legalNoticeMarkdown.literals).toEqual({
			ADDRESS: formatPostalAddress(LEGAL_CONFIG.address),
			LAST_UPDATED: formatLegalContentDate(LEGAL_CONTENT_DATES.impressum),
			ORGANIZATION_NAME: organizationName,
			OPERATOR_NAME: LEGAL_CONFIG.operatorName
		});
	});

	it('recognizes inline and reference-style destinations for route validation', () => {
		expect(
			markdownDestinations(
				'[Inline](privacy)\n[Reference][policy]\nA statement.[^1]\n\n[policy]: <terms>\n[^1]: Supporting text.'
			)
		).toEqual(['privacy', 'terms']);
	});

	it.each([
		['Privacy Policy', privacyMarkdown.markdown],
		['Terms of Service', termsMarkdown.markdown],
		['About', aboutMarkdown.markdown],
		['Contact', contactMarkdown.markdown],
		['Legal notice', legalNoticeMarkdown.markdown]
	])('keeps every relative link in %s on a public marketing route', (_name, document) => {
		const allowed = new Set(
			PUBLIC_MARKETING_ROUTES.map((route) => route.pathSuffix.replace(/^\//, '')).filter(Boolean)
		);
		const destinations = markdownDestinations(document);
		for (const destination of destinations) {
			if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(destination)) continue;
			const route = destination.replace(/#.*$/, '');
			expect(allowed.has(route), `Unexpected relative link: ${destination}`).toBe(true);
		}
	});

	it('leaves contact addresses to the obfuscated page controls', () => {
		for (const document of legalDocuments) {
			expect(document.markdown).not.toContain(getLegalEmailAddress());
			expect(Object.values(document.literals)).not.toContain(getLegalEmailAddress());
		}
	});
});
