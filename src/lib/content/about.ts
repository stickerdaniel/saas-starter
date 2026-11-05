import { LEGAL_CONFIG } from '#lib/config/legal.js';
import aboutTemplate from './legal/about.md?raw';
import { createLegalMarkdown } from './legal-template';
import { operatorFirstName } from './operator';

export const aboutMarkdown = createLegalMarkdown('About', aboutTemplate, {
	BRAND_NAME: LEGAL_CONFIG.brandName,
	OPERATOR_FIRST_NAME: operatorFirstName
});
