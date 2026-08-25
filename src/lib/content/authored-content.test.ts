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
		...document.matchAll(/^\s{0,3}\[[^\]\r\n]+\]:\s*(?:<([^>\s]+)>|([^\s]+))/gm)
	].map((match) => match[1] ?? match[2]!);
	return [...inline, ...references];
}

describe('authored legal content', () => {
	it('renders configured identity and authored dates', () => {
		expect(privacyMarkdown).toContain(`# Privacy Policy`);
		expect(privacyMarkdown).toContain(LEGAL_CONFIG.brandName);
		expect(privacyMarkdown).toContain(LEGAL_CONFIG.operatorName);
		expect(privacyMarkdown).toContain(formatLegalContentDate(LEGAL_CONTENT_DATES.privacy));

		expect(termsMarkdown).toContain(`# Terms of Service`);
		expect(termsMarkdown).toContain(LEGAL_CONFIG.brandName);
		expect(termsMarkdown).toContain(formatLegalContentDate(LEGAL_CONTENT_DATES.terms));
		expect(termsMarkdown).toContain('[Privacy Policy](privacy)');

		expect(impressumMarkdown).toContain(`# Impressum`);
		expect(impressumMarkdown).toContain(LEGAL_CONFIG.operatorName);
		expect(impressumMarkdown).toContain(LEGAL_CONFIG.address);
		expect(impressumMarkdown).toContain(formatLegalContentDate(LEGAL_CONTENT_DATES.impressum));
	});

	it('recognizes inline and reference-style destinations for route validation', () => {
		expect(
			markdownDestinations('[Inline](privacy)\n[Reference][policy]\n\n[policy]: <terms>')
		).toEqual(['privacy', 'terms']);
	});

	it.each([
		['Privacy Policy', privacyMarkdown],
		['Terms of Service', termsMarkdown],
		['Impressum', impressumMarkdown]
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
			expect(document).not.toContain(getLegalEmailAddress());
		}
	});
});
