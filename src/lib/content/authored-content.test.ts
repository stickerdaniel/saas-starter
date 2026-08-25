import { describe, expect, it } from 'vitest';
import { getLegalEmailAddress, LEGAL_CONFIG } from '$lib/config/legal';
import { impressumMarkdown } from './impressum';
import { LEGAL_CONTENT_DATES, formatLegalContentDate } from './legal-metadata';
import { privacyMarkdown } from './privacy';
import { termsMarkdown } from './terms';

const legalDocuments = [privacyMarkdown, termsMarkdown, impressumMarkdown];

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

	it('leaves contact addresses to the obfuscated page controls', () => {
		for (const document of legalDocuments) {
			expect(document).not.toContain(getLegalEmailAddress());
			expect(document).not.toMatch(/\{\{[A-Z][A-Z0-9_]*\}\}/);
		}
	});
});
