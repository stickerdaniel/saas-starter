import { LEGAL_CONFIG, formatPostalAddress } from '#lib/config/legal.js';
import impressumTemplate from './legal/impressum.md?legal-document';
import { LEGAL_CONTENT_DATES } from './legal-content-dates';
import { formatLegalContentDate } from './legal-metadata';
import { createLegalDocument } from './legal-template';

export const impressumDocument = createLegalDocument('Impressum', impressumTemplate, {
	ADDRESS: formatPostalAddress(LEGAL_CONFIG.address),
	LAST_UPDATED: formatLegalContentDate(LEGAL_CONTENT_DATES.impressum),
	OPERATOR_NAME: LEGAL_CONFIG.operatorName
});
