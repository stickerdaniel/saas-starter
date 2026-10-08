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
	delete env.APP_BUILD_SHA;
	Object.assign(env, hostEnvironment);
	const moduleUrl = pathToFileURL(path.resolve('scripts/app-version.ts')).href;

	return spawnSync(
		'bun',
		[
			'--eval',
			`const { appVersion } = await import(${JSON.stringify(moduleUrl)}); console.log(appVersion());`
		],
		{ cwd, env, encoding: 'utf8' }
	);
}

// Guards the deploy-recovery contract in the SvelteKit config: the app version name
// must be deterministic per commit (not the default build timestamp) and polling
// must be enabled, otherwise updated.current never flips and the beforeNavigate
// guard in the root layout cannot recover from a stale chunk hash after a deploy.
describe('kit.version config', () => {
	const config = fs.readFileSync(path.resolve('vite.config.ts'), 'utf-8');

	it('names the version after the checked-out commit', () => {
		const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
		const result = evaluateConfig(path.resolve('.'));

		expect(result.status).toBe(0);
		expect(result.stdout.trim()).toBe(head);
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
		expect(match, 'pollInterval not found in vite.config.ts').not.toBeNull();
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
