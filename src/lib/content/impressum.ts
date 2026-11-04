import { LEGAL_CONFIG, formatPostalAddress } from '#lib/config/legal.js';
import impressumTemplate from './legal/impressum.md?raw';
import { LEGAL_CONTENT_DATES, formatLegalContentDate } from './legal-metadata';
import { createLegalMarkdown } from './legal-template';

export const impressumMarkdown = createLegalMarkdown('Impressum', impressumTemplate, {
	ADDRESS: formatPostalAddress(LEGAL_CONFIG.address),
	LAST_UPDATED: formatLegalContentDate(LEGAL_CONTENT_DATES.impressum),
	OPERATOR_NAME: LEGAL_CONFIG.operatorName
});
