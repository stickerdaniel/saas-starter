import { docsSource } from '../source';

export const fixtureDocs = docsSource(
	'src/lib/docs/__fixtures__/docs/',
	import.meta.glob<string>('/src/lib/docs/__fixtures__/docs/**/*.md', {
		query: '?raw',
		import: 'default',
		eager: true
	}),
	import.meta.glob<string>('/src/lib/docs/__fixtures__/docs/assets/*', {
		query: '?url',
		import: 'default',
		eager: true
	})
);
