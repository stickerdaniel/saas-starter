import { docsSource } from './source';

export const repositoryDocs = docsSource(
	'docs/',
	import.meta.glob<string>('/docs/**/*.md', { query: '?raw', import: 'default', eager: true }),
	import.meta.glob<string>('/docs/assets/*', { query: '?url', import: 'default', eager: true })
);
