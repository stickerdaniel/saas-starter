export interface StructuredDataPublisherConfig {
	name: string;
	description?: string;
	logo?: {
		path: `/${string}`;
		width: number;
		height: number;
	};
	sameAs?: readonly string[];
}

export interface SiteConfig {
	githubSlug: `${string}/${string}`;
	structuredData: {
		alternateNames?: readonly string[];
		sameAs?: readonly string[];
		publisher?: StructuredDataPublisherConfig;
	};
}

export const SITE_CONFIG = {
	githubSlug: 'stickerdaniel/saas-starter',
	structuredData: {
		alternateNames: [],
		sameAs: []
	}
} satisfies SiteConfig;

export function getRepositoryUrl(): string {
	return `https://github.com/${SITE_CONFIG.githubSlug}`;
}

export function getRepositoryDocumentUrl(path: string): string {
	const normalizedPath = path.replace(/^\/+/, '');
	return `https://raw.githubusercontent.com/${SITE_CONFIG.githubSlug}/HEAD/${normalizedPath}`;
}
