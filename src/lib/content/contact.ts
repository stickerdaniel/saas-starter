import { LEGAL_CONFIG } from '#lib/config/legal.js';
import contactTemplate from './legal/contact.md?raw';
import { createLegalMarkdown } from './legal-template';

export const contactMarkdown = createLegalMarkdown('Contact', contactTemplate, {
	BRAND_NAME: LEGAL_CONFIG.brandName
});
