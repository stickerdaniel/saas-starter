import { LEGAL_CONFIG } from '$lib/config/legal';
import privacyTemplate from './legal/privacy.md?raw';
import { renderAuthoredTemplate } from './authored-template';
import { LEGAL_CONTENT_DATES, formatLegalContentDate } from './legal-metadata';

export const privacyMarkdown = renderAuthoredTemplate('Privacy Policy', privacyTemplate, {
	BRAND_NAME: LEGAL_CONFIG.brandName,
	LAST_UPDATED: formatLegalContentDate(LEGAL_CONTENT_DATES.privacy),
	OPERATOR_NAME: LEGAL_CONFIG.operatorName
});
