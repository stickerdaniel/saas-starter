import { LEGAL_CONFIG } from '$lib/config/legal';
import privacyTemplate from './legal/privacy.md?raw';
import { LEGAL_CONTENT_DATES, formatLegalContentDate } from './legal-metadata';
import { createLegalMarkdown } from './legal-template';

export const privacyMarkdown = createLegalMarkdown('Privacy Policy', privacyTemplate, {
	BRAND_NAME: LEGAL_CONFIG.brandName,
	LAST_UPDATED: formatLegalContentDate(LEGAL_CONTENT_DATES.privacy),
	OPERATOR_NAME: LEGAL_CONFIG.operatorName
});
