import type { StructuredDataPublisherConfig } from '$lib/config/site';
import { normalizeSiteOrigin } from '$lib/config/origin';

interface SiteStructuredDataInput {
	origin: string;
	name: string;
	description: string;
	languages: readonly string[];
	repositoryUrl: string;
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

export function buildSiteStructuredData(input: SiteStructuredDataInput): JsonLdNode {
	const origin = normalizeSiteOrigin(input.origin);
	const root = `${origin}/`;
	const websiteId = `${root}#website`;
	const sameAs = uniqueUrls([input.repositoryUrl, ...(input.sameAs ?? [])]);
	const graph: JsonLdNode[] = [
		{
			'@type': 'WebSite',
			'@id': websiteId,
			url: root,
			name: input.name,
			description: input.description,
			inLanguage: [...input.languages],
			...(input.alternateNames?.length ? { alternateName: [...input.alternateNames] } : {}),
			...(sameAs.length ? { sameAs } : {})
		}
	];

	if (input.publisher) {
		const publisherId = `${root}#organization`;
		const publisherSameAs = uniqueUrls(input.publisher.sameAs ?? []);
		const publisher: JsonLdNode = {
			'@type': 'Organization',
			'@id': publisherId,
			name: input.publisher.name,
			url: root,
			...(input.publisher.description ? { description: input.publisher.description } : {}),
			...(publisherSameAs.length ? { sameAs: publisherSameAs } : {})
		};

		if (input.publisher.logo) {
			const logoId = `${root}#organization-logo`;
			const logoUrl = new URL(input.publisher.logo.path, root).toString();
			graph.push({
				'@type': 'ImageObject',
				'@id': logoId,
				url: logoUrl,
				contentUrl: logoUrl,
				width: input.publisher.logo.width,
				height: input.publisher.logo.height
			});
			publisher.logo = { '@id': logoId };
		}

		graph.push(publisher);
		(graph[0] as JsonLdNode).publisher = { '@id': publisherId };
	}

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
