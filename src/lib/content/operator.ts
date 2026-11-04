import { LEGAL_CONFIG } from '#lib/config/legal.js';

/** The first word of the operator name; About introduces the maintainer by it. */
export const operatorFirstName = LEGAL_CONFIG.operatorName.trim().replace(/\s.*/s, '');
