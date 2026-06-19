import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGAL_CONFIG } from '../src/lib/config/legal';

const STATIC_DIR = path.resolve('static');

interface ManifestIcon {
	src: string;
	sizes: string;
	type: string;
	purpose: string;
}
interface Manifest {
	name: string;
	short_name: string;
	icons: ManifestIcon[];
}

const manifest: Manifest = JSON.parse(
	fs.readFileSync(path.join(STATIC_DIR, 'manifest.webmanifest'), 'utf-8')
);

describe('PWA manifest', () => {
	it('every icon src maps to an existing file under static/', () => {
		for (const icon of manifest.icons) {
			const file = path.join(STATIC_DIR, icon.src.replace(/^\//, ''));
			expect(fs.existsSync(file), `${icon.src} not found in static/`).toBe(true);
		}
	});

	it('has at least one maskable icon', () => {
		const maskable = manifest.icons.filter((i) => i.purpose.includes('maskable'));
		expect(maskable.length).toBeGreaterThanOrEqual(1);
	});

	it('name and short_name equal the configured brand name', () => {
		expect(manifest.name).toBe(LEGAL_CONFIG.brandName);
		expect(manifest.short_name).toBe(LEGAL_CONFIG.brandName);
	});

	it('app.html links the apple-touch-icon and the manifest', () => {
		const appHtml = fs.readFileSync(path.resolve('src/app.html'), 'utf-8');
		expect(appHtml).toContain('rel="apple-touch-icon"');
		expect(appHtml).toContain('href="%sveltekit.assets%/apple-touch-icon.png"');
		expect(appHtml).toContain('rel="manifest"');
		expect(appHtml).toContain('href="%sveltekit.assets%/manifest.webmanifest"');
	});

	it('apple-touch-icon.png exists under static/', () => {
		expect(fs.existsSync(path.join(STATIC_DIR, 'apple-touch-icon.png'))).toBe(true);
	});
});

describe('favicon set', () => {
	const appHtml = fs.readFileSync(path.resolve('src/app.html'), 'utf-8');

	it('ships the modern favicon files under static/', () => {
		for (const f of ['favicon.svg', 'favicon-96x96.png', 'favicon.ico']) {
			expect(fs.existsSync(path.join(STATIC_DIR, f)), `${f} missing`).toBe(true);
		}
	});

	it('app.html references the modern favicon set', () => {
		expect(appHtml).toContain('href="%sveltekit.assets%/favicon.ico"');
		expect(appHtml).toContain('href="%sveltekit.assets%/favicon.svg"');
		expect(appHtml).toContain('href="%sveltekit.assets%/favicon-96x96.png"');
		expect(appHtml).toContain('sizes="180x180"');
		expect(appHtml).toContain('name="apple-mobile-web-app-title"');
	});

	it('no longer references the legacy favicon.png', () => {
		expect(appHtml).not.toContain('favicon.png');
		expect(fs.existsSync(path.join(STATIC_DIR, 'favicon.png'))).toBe(false);
	});

	// Anti-drift: the vector favicon is generated from logo.svg, so every logo
	// path must appear verbatim in favicon.svg. Catches a logo change that forgets
	// to regenerate (or a hand-edit that desyncs them). Scoped to <path d="..."> so
	// data-*/aria-* attributes ending in `d` can never feed junk into the assert.
	it('favicon.svg contains every path from logo.svg', () => {
		const logo = fs.readFileSync(path.join(STATIC_DIR, 'logo.svg'), 'utf-8');
		const favicon = fs.readFileSync(path.join(STATIC_DIR, 'favicon.svg'), 'utf-8');
		const paths = [...logo.matchAll(/<path[^>]*\bd="([^"]+)"/g)].map((m) => m[1]);
		expect(paths.length).toBeGreaterThan(0);
		for (const d of paths) {
			expect(favicon, `favicon.svg missing logo path ${d.slice(0, 24)}…`).toContain(d);
		}
	});
});
