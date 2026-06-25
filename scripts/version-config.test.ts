import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

// Guards the deploy-recovery contract in svelte.config.js: the app version name
// must be deterministic per commit (not the default build timestamp) and polling
// must be enabled, otherwise updated.current never flips and the beforeNavigate
// guard in the root layout cannot recover from a stale chunk hash after a deploy.
describe('kit.version config', () => {
	const config = fs.readFileSync(path.resolve('svelte.config.js'), 'utf-8');

	it('derives version.name from a commit SHA, not a timestamp', () => {
		expect(config).toContain('WORKERS_CI_COMMIT_SHA');
		expect(config).toContain('VERCEL_GIT_COMMIT_SHA');
		expect(config).toContain('git rev-parse HEAD');
		// A timestamp or random source would defeat version detection.
		expect(config).not.toMatch(/version[\s\S]{0,80}Date\.now/);
		expect(config).not.toMatch(/version[\s\S]{0,80}Math\.random/);
	});

	it('sets a non-zero pollInterval so updated.current can flip', () => {
		const match = config.match(/pollInterval:\s*(\d+)/);
		expect(match, 'pollInterval not found in svelte.config.js').not.toBeNull();
		expect(Number(match![1])).toBeGreaterThan(0);
	});

	it('registers the beforeNavigate recovery guard in the root layout', () => {
		const layout = fs.readFileSync(path.resolve('src/routes/+layout.svelte'), 'utf-8');
		expect(layout).toContain("import { beforeNavigate } from '$app/navigation'");
		// updated must come from $app/state, not the deprecated $app/stores.
		expect(layout).toMatch(/import \{[^}]*\bupdated\b[^}]*\} from '\$app\/state'/);
		expect(layout).toContain('updated.current');
		expect(layout).toContain('location.href = to.url.href');
	});

	it('registers a vite:preloadError backstop that reloads once', () => {
		const layout = fs.readFileSync(path.resolve('src/routes/+layout.svelte'), 'utf-8');
		expect(layout).toContain("addEventListener('vite:preloadError'");
		expect(layout).toContain('location.reload()');
		// A sessionStorage guard must gate the reload so a stale shell cannot loop.
		expect(layout).toMatch(/sessionStorage\.getItem\(['"]sk:preload-reloaded['"]\)/);
	});
});
