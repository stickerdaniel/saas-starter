import { LEGAL_CONFIG, formatPostalAddress } from '#lib/config/legal.js';
import contactTemplate from './legal/contact.md?raw';
import { createLegalMarkdown } from './legal-template';

export const contactMarkdown = createLegalMarkdown('Contact', contactTemplate, {
	ADDRESS: formatPostalAddress(LEGAL_CONFIG.address),
	BRAND_NAME: LEGAL_CONFIG.brandName,
	// A sole proprietor leaves the company empty; the operator then is the provider.
	ORGANIZATION_NAME: LEGAL_CONFIG.companyName || LEGAL_CONFIG.operatorName,
	OPERATOR_NAME: LEGAL_CONFIG.operatorName
});
