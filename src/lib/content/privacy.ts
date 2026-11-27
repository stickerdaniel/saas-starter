import { LEGAL_CONFIG } from '#lib/config/legal.js';
import privacyTemplate from './legal/privacy.md?legal-document';
import { LEGAL_CONTENT_DATES } from './legal-content-dates';
import { formatLegalContentDate } from './legal-metadata';
import { createLegalDocument } from './legal-template';

export const privacyDocument = createLegalDocument('Privacy Policy', privacyTemplate, {
	BRAND_NAME: LEGAL_CONFIG.brandName,
	LAST_UPDATED: formatLegalContentDate(LEGAL_CONTENT_DATES.privacy),
	OPERATOR_NAME: LEGAL_CONFIG.operatorName
});
