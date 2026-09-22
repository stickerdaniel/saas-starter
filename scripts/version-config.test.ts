import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

function evaluateConfig(cwd: string, hostEnvironment: Record<string, string> = {}) {
	const env = { ...process.env };
	delete env.WORKERS_CI_COMMIT_SHA;
	delete env.VERCEL_GIT_COMMIT_SHA;
	Object.assign(env, hostEnvironment);
	const configUrl = pathToFileURL(path.resolve('svelte.config.js')).href;

	return spawnSync(
		process.execPath,
		[
			'--eval',
			`const config = (await import(${JSON.stringify(configUrl)})).default; console.log(config.kit.version.name);`
		],
		{ cwd, env, encoding: 'utf8' }
	);
}

// Guards the deploy-recovery contract in svelte.config.js: the app version name
// must be deterministic per commit (not the default build timestamp) and polling
// must be enabled, otherwise updated.current never flips and the beforeNavigate
// guard in the root layout cannot recover from a stale chunk hash after a deploy.
describe('kit.version config', () => {
	const config = fs.readFileSync(path.resolve('svelte.config.js'), 'utf-8');

	it('derives version.name from a commit SHA, not a timestamp', () => {
		expect(config).toContain('WORKERS_CI_COMMIT_SHA');
		expect(config).toContain('VERCEL_GIT_COMMIT_SHA');
		expect(config).toContain("execFileSync('git', ['rev-parse', 'HEAD']");
		// A timestamp or random source would defeat version detection.
		expect(config).not.toMatch(/version[\s\S]{0,80}Date\.now/);
		expect(config).not.toMatch(/version[\s\S]{0,80}Math\.random/);
	});

	it('quietly falls back to dev outside a Git checkout', () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'version-config-non-git-'));

		try {
			const result = evaluateConfig(directory);

			expect(result.status).toBe(0);
			expect(result.stdout.trim()).toBe('dev');
			expect(result.stderr).toBe('');
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	it.each(['directory', 'file'] as const)(
		'preserves Git diagnostics for an invalid .git %s',
		(metadataKind) => {
			const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'version-config-invalid-git-'));
			const metadata = path.join(directory, '.git');
			const nested = path.join(directory, 'project', 'src');

			try {
				if (metadataKind === 'directory') fs.mkdirSync(metadata);
				else fs.writeFileSync(metadata, 'gitdir: missing\n');
				fs.mkdirSync(nested, { recursive: true });
				const result = evaluateConfig(nested);

				expect(result.status).toBe(0);
				expect(result.stdout.trim()).toBe('dev');
				expect(result.stderr).not.toBe('');
			} finally {
				fs.rmSync(directory, { recursive: true, force: true });
			}
		}
	);

	it('prefers the Workers commit SHA over the Vercel commit SHA', () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'version-config-host-sha-'));

		try {
			const result = evaluateConfig(directory, {
				WORKERS_CI_COMMIT_SHA: 'workers-commit',
				VERCEL_GIT_COMMIT_SHA: 'vercel-commit'
			});

			expect(result.status).toBe(0);
			expect(result.stdout.trim()).toBe('workers-commit');
			expect(result.stderr).toBe('');
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	it('sets a non-zero pollInterval so updated.current can flip', () => {
		const match = config.match(/pollInterval:\s*(\d+)/);
		expect(match, 'pollInterval not found in svelte.config.js').not.toBeNull();
		expect(Number(match![1])).toBeGreaterThan(0);
	});

	it('registers the beforeNavigate recovery guard in the root layout', () => {
		const layout = fs.readFileSync(path.resolve('src/routes/+layout.svelte'), 'utf-8');
		// Structural match so other navigation imports (e.g. onNavigate) can share the line.
		expect(layout).toMatch(/import \{[^}]*\bbeforeNavigate\b[^}]*\} from '\$app\/navigation'/);
		// updated must come from $app/state, not the deprecated $app/stores.
		expect(layout).toMatch(/import \{[^}]*\bupdated\b[^}]*\} from '\$app\/state'/);
		expect(layout).toContain('updated.current');
		// The layout still hands the deploy signal to the decision and acts on the
		// answer. Which navigations that answer covers is settled by
		// deployReloadTarget's own tests, not by matching source text here.
		expect(layout).toMatch(/deployReloadTarget\([^)]*updated\.current/);
		expect(layout).toContain('location.href =');
	});

	it('registers a vite:preloadError backstop that reloads once', () => {
		const appHtml = fs.readFileSync(path.resolve('src/app.html'), 'utf-8');
		expect(appHtml).toContain("addEventListener('vite:preloadError'");
		expect(appHtml).toContain('location.reload()');
		// A sessionStorage guard must gate the reload so a stale shell cannot loop.
		expect(appHtml).toMatch(/sessionStorage\.getItem\(['"]sk:preload-reloaded['"]\)/);
	});
});
