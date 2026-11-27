import { SITE_CONFIG } from '#lib/config/site.js';
import { docsCatalog } from './catalog';
import { publishDocs } from './engine';
import { repositoryDocs } from './source.server';

export const publishedDocs = publishDocs(docsCatalog, repositoryDocs, SITE_CONFIG.githubSlug);
