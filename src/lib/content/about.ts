import { LEGAL_CONFIG } from '#lib/config/legal.js';
import aboutTemplate from './legal/about.md?legal-document';
import { createLegalDocument } from './legal-template';
import { operatorFirstName } from './operator';

export const aboutDocument = createLegalDocument('About', aboutTemplate, {
	BRAND_NAME: LEGAL_CONFIG.brandName,
	OPERATOR_FIRST_NAME: operatorFirstName
});
