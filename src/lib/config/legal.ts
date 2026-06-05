export const LEGAL_CONFIG = {
	brandName: 'SaaS Starter',
	companyName: 'SaaS Starter Inc.',
	operatorName: 'Daniel Sticker',
	address: '123 Main Street, Suite 100, San Francisco, CA 94102',
	email: {
		user: 'daniel',
		domain: 'sticker',
		tld: 'name'
	}
} as const;

/** @public Kept for forks: raw address for mailto links (see #398); pages render the obfuscated variant. */
export function getLegalEmailAddress(): string {
	return `${LEGAL_CONFIG.email.user}@${LEGAL_CONFIG.email.domain}.${LEGAL_CONFIG.email.tld}`;
}

export function getObfuscatedLegalEmailAddress(): string {
	return `${LEGAL_CONFIG.email.user} [at] ${LEGAL_CONFIG.email.domain} [dot] ${LEGAL_CONFIG.email.tld}`;
}
