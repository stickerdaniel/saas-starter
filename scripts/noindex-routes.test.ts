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
	it('SEOHead gates robots/canonical/hreflang behind the noindex prop', () => {
		const source = fs.readFileSync(path.resolve('src/lib/components/SEOHead.svelte'), 'utf-8');

		// noindex emits a robots meta tag
		expect(source).toContain('name="robots"');
		expect(source).toMatch(/content="noindex,\s*nofollow"/);

		// canonical + hreflang are gated behind {#if !noindex}
		expect(source).toContain('{#if !noindex}');
		const canonicalIndex = source.indexOf('rel="canonical"');
		const hreflangIndex = source.indexOf('hreflang=');
		expect(canonicalIndex).toBeGreaterThan(-1);
		expect(hreflangIndex).toBeGreaterThan(-1);

		// Each gated block must be preceded by an {#if !noindex} guard.
		for (const marker of ['rel="canonical"', 'hreflang=']) {
			const idx = source.indexOf(marker);
			const guardIdx = source.lastIndexOf('{#if !noindex}', idx);
			expect(guardIdx, `${marker} should sit inside an {#if !noindex} block`).toBeGreaterThan(-1);
		}
	});

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

	it('does not render a global SEOHead in the root layout (avoids duplicate canonical/og/hreflang)', () => {
		// Every +page.svelte renders its own SEOHead; a second global instance in the
		// root layout duplicated canonical/og/hreflang on every page and emitted a
		// canonical on noindex routes. The per-page SEOHead is the single source.
		const rootLayout = fs.readFileSync(path.resolve('src/routes/+layout.svelte'), 'utf-8');
		expect(rootLayout).not.toMatch(/<SEOHead\b/);
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
