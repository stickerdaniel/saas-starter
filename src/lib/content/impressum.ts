import { LEGAL_CONFIG } from '$lib/config/legal';
import impressumTemplate from './legal/impressum.md?raw';
import { renderAuthoredTemplate } from './authored-template';
import { LEGAL_CONTENT_DATES, formatLegalContentDate } from './legal-metadata';

export const impressumMarkdown = renderAuthoredTemplate('Impressum', impressumTemplate, {
	ADDRESS: LEGAL_CONFIG.address,
	LAST_UPDATED: formatLegalContentDate(LEGAL_CONTENT_DATES.impressum),
	OPERATOR_NAME: LEGAL_CONFIG.operatorName
});
