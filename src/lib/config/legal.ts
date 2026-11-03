export const LEGAL_CONFIG = {
	brandName: 'SaaS Starter',
	companyName: 'SaaS Starter Inc.',
	operatorName: 'Daniel Sticker',
	address: {
		streetAddress: '123 Main Street, Suite 100',
		postalCode: '94102',
		addressLocality: 'San Francisco',
		addressCountry: 'US'
	},
	email: {
		user: 'daniel',
		domain: 'sticker',
		tld: 'name'
	}
} as const;

/** Schema.org PostalAddress fields; `addressCountry` holds a two-letter code such as `US`. */
export interface LegalPostalAddress {
	streetAddress: string;
	postalCode: string;
	addressLocality: string;
	addressCountry: string;
}

/** Renders the address on one line as `street, postalCode locality, country`. */
export function formatPostalAddress(address: LegalPostalAddress): string {
	return `${address.streetAddress}, ${address.postalCode} ${address.addressLocality}, ${address.addressCountry}`;
}

/** @public Kept for forks: raw address for mailto links (see #398); pages render the obfuscated variant. */
export function getLegalEmailAddress(): string {
	return `${LEGAL_CONFIG.email.user}@${LEGAL_CONFIG.email.domain}.${LEGAL_CONFIG.email.tld}`;
}

export function getObfuscatedLegalEmailAddress(): string {
	return `${LEGAL_CONFIG.email.user} [at] ${LEGAL_CONFIG.email.domain} [dot] ${LEGAL_CONFIG.email.tld}`;
}
