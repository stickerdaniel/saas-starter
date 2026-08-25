import { LEGAL_CONFIG } from '$lib/config/legal';
import termsTemplate from './legal/terms.md?raw';
import { renderAuthoredTemplate } from './authored-template';
import { LEGAL_CONTENT_DATES, formatLegalContentDate } from './legal-metadata';

export const termsMarkdown = renderAuthoredTemplate('Terms of Service', termsTemplate, {
	BRAND_NAME: LEGAL_CONFIG.brandName,
	LAST_UPDATED: formatLegalContentDate(LEGAL_CONTENT_DATES.terms),
	OPERATOR_NAME: LEGAL_CONFIG.operatorName
});
