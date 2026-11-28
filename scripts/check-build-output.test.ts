import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	DOCS_FIXTURE_MARKER,
	findDocsFixtureMarker,
	findLinkedStylesheets,
	findPrerenderedDocsFiles,
	findPrerenderedNegotiatedMarketingPages,
	findPrerenderOriginPlaceholders
} from './check-build-output';

function outputTree(files: Record<string, string>, check: (root: string) => void): void {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-output-'));
	try {
		for (const [file, content] of Object.entries(files)) {
			fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
			fs.writeFileSync(path.join(root, file), content);
		}
		check(root);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
}

describe('findPrerenderOriginPlaceholders', () => {
	it('reports placeholder origins only in public text artifacts', () => {
		const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prerender-origin-'));
		try {
			fs.mkdirSync(path.join(outDir, 'en'), { recursive: true });
			fs.writeFileSync(
				path.join(outDir, 'en', 'index.html'),
				'<link href="http://sveltekit-prerender/en">'
			);
			fs.writeFileSync(
				path.join(outDir, 'server.js'),
				'const placeholder = "http://sveltekit-prerender";'
			);

			expect(findPrerenderOriginPlaceholders(outDir)).toEqual([
				path.join(outDir, 'en', 'index.html')
			]);
		} finally {
			fs.rmSync(outDir, { recursive: true, force: true });
		}
	});
});

describe('findPrerenderedNegotiatedMarketingPages', () => {
	it('reports only registered localized marketing documents', () => {
		const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'negotiated-prerender-'));
		try {
			fs.mkdirSync(path.join(outDir, 'de/privacy'), { recursive: true });
			fs.mkdirSync(path.join(outDir, 'en/docs'), { recursive: true });
			fs.writeFileSync(path.join(outDir, 'en.html'), 'home');
			fs.writeFileSync(path.join(outDir, 'de/privacy/index.html'), 'privacy');
			fs.writeFileSync(path.join(outDir, 'en/docs/index.html'), 'unrelated');

			expect(findPrerenderedNegotiatedMarketingPages(outDir)).toEqual([
				path.join(outDir, 'en.html'),
				path.join(outDir, 'de/privacy/index.html')
			]);
		} finally {
			fs.rmSync(outDir, { recursive: true, force: true });
		}
	});
});

describe('findPrerenderedDocsFiles', () => {
	it('reports prerendered docs pages and Markdown twins in every language and without one', () => {
		outputTree(
			{
				'pages/en/docs.html': 'entry',
				'pages/de/docs/reference/code.html': 'page',
				'dependencies/fr/docs.md': 'twin',
				'pages/docs.html': 'entry without a language',
				'pages/docs/reference.html': 'page without a language',
				'dependencies/docs.md': 'twin without a language',
				'pages/en/documentation.html': 'unrelated',
				'pages/docsx.html': 'unrelated',
				'pages/en/about.html': 'unrelated'
			},
			(root) =>
				expect(findPrerenderedDocsFiles(root).toSorted()).toEqual(
					[
						'dependencies/docs.md',
						'dependencies/fr/docs.md',
						'pages/de/docs/reference/code.html',
						'pages/docs.html',
						'pages/docs/reference.html',
						'pages/en/docs.html'
					].map((file) => path.join(root, file))
				)
		);
	});
});

describe('findDocsFixtureMarker', () => {
	it('reports output files that hold the docs fixture catalog', () => {
		outputTree(
			{
				'server/chunks/catalog.js': `const body = "${DOCS_FIXTURE_MARKER}";`,
				'server/chunks/other.js': 'const body = "ordinary";',
				'client/_app/immutable/assets/image.gif': DOCS_FIXTURE_MARKER
			},
			(root) =>
				expect(findDocsFixtureMarker(root)).toEqual([path.join(root, 'server/chunks/catalog.js')])
		);
	});
});

describe('findLinkedStylesheets', () => {
	it('reports bundled stylesheets that reach the inline threshold', () => {
		const clientDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linked-styles-'));
		try {
			fs.mkdirSync(path.join(clientDir, '.vite'), { recursive: true });
			fs.mkdirSync(path.join(clientDir, '_app/immutable/assets'), { recursive: true });
			fs.writeFileSync(
				path.join(clientDir, '.vite/manifest.json'),
				JSON.stringify({
					'nodes/0.js': {
						file: '_app/immutable/nodes/0.js',
						css: ['_app/immutable/assets/shared.css']
					},
					'nodes/1.js': {
						file: '_app/immutable/nodes/1.js',
						css: ['_app/immutable/assets/route.css'],
						assets: ['_app/immutable/assets/linked.css']
					},
					'src/linked.css': {
						file: '_app/immutable/assets/linked.css',
						src: 'src/linked.css'
					}
				})
			);
			fs.writeFileSync(path.join(clientDir, '_app/immutable/assets/shared.css'), 'a'.repeat(10));
			fs.writeFileSync(path.join(clientDir, '_app/immutable/assets/route.css'), 'a'.repeat(9));
			// Imported with `?url`: the page links it whatever the threshold.
			fs.writeFileSync(path.join(clientDir, '_app/immutable/assets/linked.css'), 'a'.repeat(20));
			// Copied from static/: SvelteKit links it regardless of the threshold.
			fs.writeFileSync(path.join(clientDir, 'static.css'), 'a'.repeat(20));

			expect(findLinkedStylesheets(clientDir, 10)).toEqual([
				{ file: '_app/immutable/assets/shared.css', length: 10 }
			]);
		} finally {
			fs.rmSync(clientDir, { recursive: true, force: true });
		}
	});
});
