import { LEGAL_CONFIG } from '#lib/config/legal.js';
import contactTemplate from './legal/contact.md?legal-document';
import { createLegalDocument } from './legal-template';

export const contactDocument = createLegalDocument('Contact', contactTemplate, {
	BRAND_NAME: LEGAL_CONFIG.brandName
});
