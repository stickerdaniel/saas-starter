import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAdapter, isCloudflareBuild } from './build-target';

/**
 * On Cloudflare the worker gets its env from the __VARLOCK_ENV binding that `varlock-wrangler`
 * uploads at deploy time; nothing is embedded in the SSR bundle. vite.config.ts injects the
 * loader that reads the binding whenever `isCloudflareBuild()` holds, so a build that picks
 * adapter-cloudflare without it would ship a boot-throwing worker, and a Node build with it
 * would never read its host environment. And deploying with bare `wrangler` uploads a worker
 * with no env.
 *
 * The other adapters (Vercel, adapter-node) have no upload step, so `resolved-env` stays the
 * delivery mechanism there and the manifest preparation stays load-bearing for them.
 */
describe('varlock Cloudflare env delivery', () => {
	it.each([
		[{ WORKERS_CI: '1' }, 'cloudflare', true],
		[{ CF_PAGES: '1' }, 'auto', true],
		[{ WORKERS_CI: '1', NODE_ADAPTER: '1' }, 'cloudflare', true],
		[{ CF_PAGES: '1', NODE_ADAPTER: '1' }, 'node', false],
		[{ CF_PAGES: '1', VERCEL: '1' }, 'auto', false],
		[{ VERCEL: '1' }, 'auto', false],
		[{ NODE_ADAPTER: '1' }, 'node', false],
		[{}, 'auto', false]
	] as const)(
		'%o selects the %s adapter and the Cloudflare loader: %s',
		(env, adapter, cloudflare) => {
			expect(buildAdapter(env)).toBe(adapter);
			expect(isCloudflareBuild(env)).toBe(cloudflare);
		}
	);

	it.each(['scripts/cf-deploy.ts', 'scripts/cf-prod-deploy.ts'])(
		'%s deploys through varlock-wrangler',
		(script) => {
			const content = fs.readFileSync(path.resolve(script), 'utf-8');
			const code = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

			const spawned = [...code.matchAll(/'(wrangler|varlock-wrangler)'/g)].map((m) => m[1]);
			expect(spawned, `no wrangler invocation found in ${script}`).not.toHaveLength(0);
			expect(spawned, `${script} must spawn varlock-wrangler, not bare wrangler`).not.toContain(
				'wrangler'
			);
		}
	);
});
