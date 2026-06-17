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
