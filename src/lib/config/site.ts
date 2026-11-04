/** Optional public profile of the organization; its name and contact data come from `LEGAL_CONFIG`. */
export interface StructuredDataPublisherConfig {
	/** Defaults to the homepage meta description. */
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

/** The repository page of one commit, for a full commit SHA such as a build's `version`. */
export function getCommitUrl(sha: string): string {
	return `${getRepositoryUrl()}/commit/${sha}`;
}

export function getRepositoryDocumentUrl(path: string): string {
	const normalizedPath = path.replace(/^\/+/, '');
	return `https://raw.githubusercontent.com/${SITE_CONFIG.githubSlug}/HEAD/${normalizedPath}`;
}
