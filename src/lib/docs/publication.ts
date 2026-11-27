import { SITE_CONFIG } from '#lib/config/site.js';
import { docsCatalog } from './catalog';
import type { DocsCatalog, RepositorySlug } from './types';

export function isPublished(catalog: DocsCatalog, siteSlug: RepositorySlug): boolean {
	return catalog.pages.length > 0 && catalog.site === siteSlug;
}

/** Whether this deployment publishes its docs catalog. Server and browser code read the same value. */
export const docsPublished = isPublished(docsCatalog, SITE_CONFIG.githubSlug);
