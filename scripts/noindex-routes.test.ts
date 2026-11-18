import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROUTES_ROOT = path.resolve('src/routes/[[lang]]');

// Recursively collect every +page.svelte under a route group directory.
function collectPages(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	const entries = fs.readdirSync(dir, { recursive: true, withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && entry.name === '+page.svelte')
		.map((entry) => path.join(entry.parentPath, entry.name));
}

// True when a +page.svelte imports the SEOHead component at all.
function usesSeoHead(source: string): boolean {
	return /SEOHead/.test(source);
}

// True when the page's <SEOHead .../> call passes the noindex prop.
function passesNoindex(source: string): boolean {
	const match = source.match(/<SEOHead\b[\s\S]*?\/>/);
	if (!match) return false;
	return /\bnoindex\b/.test(match[0]);
}

describe('private route noindex', () => {
	it('every (auth), app, and admin +page.svelte using SEOHead passes noindex', () => {
		const privatePages = [
			...collectPages(path.join(ROUTES_ROOT, '(auth)')),
			...collectPages(path.join(ROUTES_ROOT, 'app')),
			...collectPages(path.join(ROUTES_ROOT, 'admin'))
		];

		// Fail loudly if the globbing finds nothing, instead of passing vacuously.
		expect(privatePages.length).toBeGreaterThan(0);

		for (const file of privatePages) {
			const source = fs.readFileSync(file, 'utf-8');
			if (!usesSeoHead(source)) continue;
			expect(passesNoindex(source), `${file} should pass noindex to SEOHead`).toBe(true);
		}
	});

	it('no (marketing) +page.svelte passes noindex', () => {
		const marketingPages = collectPages(path.join(ROUTES_ROOT, '(marketing)'));

		// Fail loudly if the globbing finds nothing, instead of passing vacuously.
		expect(marketingPages.length).toBeGreaterThan(0);

		for (const file of marketingPages) {
			const source = fs.readFileSync(file, 'utf-8');
			if (!usesSeoHead(source)) continue;
			expect(passesNoindex(source), `${file} should not pass noindex to SEOHead`).toBe(false);
		}
	});
});
