import { LEGAL_CONFIG } from '$lib/config/legal';
import termsTemplate from './legal/terms.md?raw';
import { LEGAL_CONTENT_DATES, formatLegalContentDate } from './legal-metadata';
import { createLegalMarkdown } from './legal-template';

export const termsMarkdown = createLegalMarkdown('Terms of Service', termsTemplate, {
	BRAND_NAME: LEGAL_CONFIG.brandName,
	LAST_UPDATED: formatLegalContentDate(LEGAL_CONTENT_DATES.terms),
	OPERATOR_NAME: LEGAL_CONFIG.operatorName
});
