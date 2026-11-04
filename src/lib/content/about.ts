import { LEGAL_CONFIG } from '#lib/config/legal.js';
import aboutTemplate from './legal/about.md?raw';
import { createLegalMarkdown } from './legal-template';

export const aboutMarkdown = createLegalMarkdown('About', aboutTemplate, {
	BRAND_NAME: LEGAL_CONFIG.brandName,
	// A sole proprietor leaves the company empty; the operator then publishes the product.
	ORGANIZATION_NAME: LEGAL_CONFIG.companyName || LEGAL_CONFIG.operatorName,
	OPERATOR_NAME: LEGAL_CONFIG.operatorName
});
