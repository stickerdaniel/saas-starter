import type { LegalPostalAddress } from '#lib/config/legal.js';
import type { StructuredDataPublisherConfig } from '#lib/config/site.js';
import { normalizeSiteOrigin } from '#lib/config/origin.js';

/** The operating organization as `LEGAL_CONFIG` defines it; `email` is the plain address. */
export interface OrganizationLegalIdentity {
	/** May be the empty string; the organization is then named after the operator. */
	companyName: string;
	operatorName: string;
	address: LegalPostalAddress;
	email: string;
}

interface SiteStructuredDataInput {
	origin: string;
	name: string;
	description: string;
	languages: readonly string[];
	repositoryUrl: string;
	legal: OrganizationLegalIdentity;
	alternateNames?: readonly string[];
	sameAs?: readonly string[];
	publisher?: StructuredDataPublisherConfig;
}

type JsonLdNode = Record<string, unknown>;

function normalizePublicUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error('Structured data URL must be a public HTTP(S) URL.');
	}
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
		throw new Error('Structured data URL must be a public HTTP(S) URL.');
	}
	return url.toString();
}

function uniqueUrls(values: readonly string[]): string[] {
	return [...new Set(values.map(normalizePublicUrl))];
}

/**
 * Builds the homepage graph: a `WebSite` whose publisher is the legal `Organization`,
 * plus the organization's logo when configured. Repository links stay on the website;
 * `publisher.sameAs` lists the organization's own profiles.
 */
export function buildSiteStructuredData(input: SiteStructuredDataInput): JsonLdNode {
	const origin = normalizeSiteOrigin(input.origin);
	const root = `${origin}/`;
	const websiteId = `${root}#website`;
	const organizationId = `${root}#organization`;
	const sameAs = uniqueUrls([input.repositoryUrl, ...(input.sameAs ?? [])]);
	const profile = input.publisher;
	const organizationSameAs = uniqueUrls(profile?.sameAs ?? []);
	const { legal } = input;

	const graph: JsonLdNode[] = [
		{
			'@type': 'WebSite',
			'@id': websiteId,
			url: root,
			name: input.name,
			description: input.description,
			inLanguage: [...input.languages],
			...(input.alternateNames?.length ? { alternateName: [...input.alternateNames] } : {}),
			...(sameAs.length ? { sameAs } : {}),
			publisher: { '@id': organizationId }
		}
	];

	const organization: JsonLdNode = {
		'@type': 'Organization',
		'@id': organizationId,
		name: legal.companyName || legal.operatorName,
		url: root,
		// Agents expect a description on the identity entity; the page description is the fallback.
		description: profile?.description || input.description,
		...(organizationSameAs.length ? { sameAs: organizationSameAs } : {}),
		contactPoint: {
			'@type': 'ContactPoint',
			contactType: 'customer support',
			email: legal.email
		},
		address: {
			'@type': 'PostalAddress',
			streetAddress: legal.address.streetAddress,
			postalCode: legal.address.postalCode,
			addressLocality: legal.address.addressLocality,
			addressCountry: legal.address.addressCountry
		}
	};

	if (profile?.logo) {
		const logoId = `${root}#organization-logo`;
		const logoUrl = new URL(profile.logo.path, root).toString();
		graph.push({
			'@type': 'ImageObject',
			'@id': logoId,
			url: logoUrl,
			contentUrl: logoUrl,
			width: profile.logo.width,
			height: profile.logo.height
		});
		organization.logo = { '@id': logoId };
	}

	graph.push(organization);

	return {
		'@context': 'https://schema.org',
		'@graph': graph
	};
}

const JSON_SCRIPT_ESCAPE: Record<string, string> = {
	'<': '\\u003C',
	'>': '\\u003E',
	'&': '\\u0026',
	'\u2028': '\\u2028',
	'\u2029': '\\u2029'
};

export function serializeStructuredData(value: unknown): string {
	return JSON.stringify(value).replace(
		/[<>&\u2028\u2029]/g,
		(character) => JSON_SCRIPT_ESCAPE[character]!
	);
}
