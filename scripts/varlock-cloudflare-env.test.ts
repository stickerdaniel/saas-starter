import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * On Cloudflare the worker gets its env from the __VARLOCK_ENV binding that `varlock-wrangler`
 * uploads at deploy time; nothing is embedded in the SSR bundle. The loader that reads the
 * binding is injected by `varlockVitePlugin()`'s adapter auto-detection, which needs
 * `@varlock/cloudflare-integration` installed and `api.options` off SvelteKit's setup plugin
 * (exposed since kit 2.62) — a kit downgrade or a removed integration would silently ship a
 * boot-throwing worker. And deploying with bare `wrangler` uploads a worker with no env.
 *
 * The other adapters (Vercel, adapter-node) have no upload step, so `resolved-env` stays the
 * delivery mechanism there and the manifest strip stays load-bearing for them. This asserts the
 * Cloudflare wiring and its preconditions, not the absence of `resolved-env` everywhere.
 */
function minVersion(range: string): [number, number] {
	const m = range.match(/(\d+)\.(\d+)/);
	if (!m) throw new Error(`cannot parse a version out of "${range}"`);
	return [Number(m[1]), Number(m[2])];
}

describe('varlock Cloudflare env delivery', () => {
	const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf-8')) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};
	const deps = { ...pkg.dependencies, ...pkg.devDependencies };

	it('keeps the auto-detection preconditions for the Cloudflare loader', () => {
		expect(
			deps['@varlock/cloudflare-integration'],
			'@varlock/cloudflare-integration must stay installed — the plugin dynamic-imports it to inject the loader'
		).toBeDefined();

		const kit = deps['@sveltejs/kit'];
		expect(kit, '@sveltejs/kit not found in package.json').toBeDefined();
		const [major, minor] = minVersion(kit!);
		// api.options (which auto-detection reads to find the Cloudflare adapter) is exposed
		// from kit 2.62. Below that the loader is never injected and the Worker boot-throws.
		expect(
			major > 2 || (major === 2 && minor >= 62),
			`@sveltejs/kit must be >= 2.62 for adapter auto-detection (found "${kit}")`
		).toBe(true);
	});

	it('the Cloudflare build path passes no options to varlockVitePlugin (auto-detection, no blob)', () => {
		const content = fs.readFileSync(path.resolve('vite.config.ts'), 'utf-8');
		// isCloudflareBuild -> {} : ... — the Cloudflare branch must not embed a blob or pass
		// ssrInjectMode; auto-detection handles the loader.
		expect(content).toMatch(/isCloudflareBuild\s*\?\s*\{\s*\}/);
	});

	it('vite.config.ts keeps the manifest strip on the non-Cloudflare adapters', () => {
		const content = fs.readFileSync(path.resolve('vite.config.ts'), 'utf-8');
		// Vercel/adapter-node still serialize the manifest into the bundle, so dropping the
		// strip there would ship @sensitive values in the artifact.
		expect(content, 'the manifest strip was removed').toContain('stripSensitiveManifestValues');
	});

	for (const script of ['scripts/cf-deploy.ts', 'scripts/cf-prod-deploy.ts']) {
		it(`${script} deploys through varlock-wrangler`, () => {
			const content = fs.readFileSync(path.resolve(script), 'utf-8');
			const code = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

			const spawned = [...code.matchAll(/'(wrangler|varlock-wrangler)'/g)].map((m) => m[1]);
			expect(spawned, `no wrangler invocation found in ${script}`).not.toHaveLength(0);
			expect(spawned, `${script} must spawn varlock-wrangler, not bare wrangler`).not.toContain(
				'wrangler'
			);
		});
	}
});
