import { LEGAL_CONFIG } from '#lib/config/legal.js';
import termsTemplate from './legal/terms.md?legal-document';
import { LEGAL_CONTENT_DATES } from './legal-content-dates';
import { formatLegalContentDate } from './legal-metadata';
import { createLegalDocument } from './legal-template';

export const termsDocument = createLegalDocument('Terms of Service', termsTemplate, {
	BRAND_NAME: LEGAL_CONFIG.brandName,
	LAST_UPDATED: formatLegalContentDate(LEGAL_CONTENT_DATES.terms),
	OPERATOR_NAME: LEGAL_CONFIG.operatorName
});
