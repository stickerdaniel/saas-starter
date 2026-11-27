import type { SiteConfig } from '#lib/config/site.js';

export type RepositorySlug = SiteConfig['githubSlug'];

/** A Markdown file by its repository path. */
export type DocsSourcePath = `${string}.md`;

/** A published Markdown page. The first page of a catalog has the slug `''` and is served at `/<lang>/docs`. */
export interface DocsPageEntry {
	source: DocsSourcePath;
	slug: string;
	section: string;
}

/**
 * The pages a site publishes. The section exists only while `pages` is not empty and `site`
 * equals the deployment's `SITE_CONFIG.githubSlug`; links to source files resolve against
 * `sourceRepository`, which defaults to `site`.
 */
export interface DocsCatalog {
	site: RepositorySlug;
	sourceRepository?: RepositorySlug;
	pages: readonly DocsPageEntry[];
}

/**
 * The Markdown files below `root`, a repository directory such as `docs/`, and the built URL of
 * each file below `<root>assets/`, both by repository path.
 */
export interface DocsSource {
	root: `${string}/`;
	markdown: Readonly<Record<string, string>>;
	assets: Readonly<Record<string, string>>;
}
