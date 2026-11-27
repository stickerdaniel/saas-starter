import type { DocsSource } from './types';

function repositoryKeys(files: Record<string, string>): Record<string, string> {
	return Object.fromEntries(Object.entries(files).map(([path, value]) => [path.slice(1), value]));
}

/** Keys root-relative glob results by repository path, so a page names its files as GitHub does. */
export function docsSource(
	root: DocsSource['root'],
	markdown: Record<string, string>,
	assets: Record<string, string>
): DocsSource {
	return { root, markdown: repositoryKeys(markdown), assets: repositoryKeys(assets) };
}
