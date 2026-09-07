import { describe, expect, it } from 'vitest';
import { getLegalEmailAddress, LEGAL_CONFIG } from '$lib/config/legal';
import { PUBLIC_MARKETING_ROUTES } from '$lib/marketing/public-routes';
import { impressumMarkdown } from './impressum';
import { LEGAL_CONTENT_DATES, formatLegalContentDate } from './legal-metadata';
import { privacyMarkdown } from './privacy';
import { termsMarkdown } from './terms';

const legalDocuments = [privacyMarkdown, termsMarkdown, impressumMarkdown];

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

		expect(impressumMarkdown.markdown).toContain('# Impressum');
		expect(impressumMarkdown.markdown).toContain('{{OPERATOR_NAME}}');
		expect(impressumMarkdown.markdown).toContain('{{ADDRESS}}');
		expect(impressumMarkdown.literals).toEqual({
			ADDRESS: LEGAL_CONFIG.address,
			LAST_UPDATED: formatLegalContentDate(LEGAL_CONTENT_DATES.impressum),
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
		['Impressum', impressumMarkdown.markdown]
	])('keeps every relative link in %s on a public marketing route', (_name, document) => {
		const allowed = new Set(
			PUBLIC_MARKETING_ROUTES.map((route) => route.pathSuffix.replace(/^\//, '')).filter(Boolean)
		);
		const destinations = markdownDestinations(document);
		for (const destination of destinations) {
			if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(destination)) continue;
			expect(allowed.has(destination), `Unexpected relative link: ${destination}`).toBe(true);
		}
	});

	it('leaves contact addresses to the obfuscated page controls', () => {
		for (const document of legalDocuments) {
			expect(document.markdown).not.toContain(getLegalEmailAddress());
			expect(Object.values(document.literals)).not.toContain(getLegalEmailAddress());
		}
	});
});
