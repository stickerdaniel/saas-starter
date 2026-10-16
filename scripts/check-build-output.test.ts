import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	findLinkedStylesheets,
	findPrerenderedNegotiatedMarketingPages,
	findPrerenderOriginPlaceholders
} from './check-build-output';

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
						css: ['_app/immutable/assets/route.css']
					}
				})
			);
			fs.writeFileSync(path.join(clientDir, '_app/immutable/assets/shared.css'), 'a'.repeat(10));
			fs.writeFileSync(path.join(clientDir, '_app/immutable/assets/route.css'), 'a'.repeat(9));
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
