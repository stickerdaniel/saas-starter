import { LEGAL_CONFIG } from '#lib/config/legal.js';
import aboutTemplate from './legal/about.md?raw';
import { createLegalMarkdown } from './legal-template';

/** The first word of the operator name; About introduces the maintainer by it. */
export const operatorFirstName = LEGAL_CONFIG.operatorName.trim().replace(/\s.*/s, '');

export const aboutMarkdown = createLegalMarkdown('About', aboutTemplate, {
	BRAND_NAME: LEGAL_CONFIG.brandName,
	OPERATOR_FIRST_NAME: operatorFirstName
});
