import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { BASE_TABLE } from '../../.agents/skills/upstream-sync/layout/v3.ts';
import { trackedPaths } from '../../.agents/skills/upstream-sync/scripts/apply-layout.ts';
import { apply } from './apply.ts';
import { moveScript, ownerProblems } from './manifests.ts';
import { staleReplacements } from './replacements.ts';
import type { Manifest } from './run.ts';

const checkout = fileURLToPath(new URL('../..', import.meta.url));
const read = (path: string) => readFileSync(join(checkout, path), 'utf8');
const rootManifest = (): Manifest => JSON.parse(read('package.json'));
const flat = { flatPaths: trackedPaths(checkout), table: BASE_TABLE };
const noScript = () => undefined;

describe('ownerProblems', () => {
	it('places every dependency and script of the root manifest', () => {
		expect(ownerProblems(rootManifest())).toEqual([]);
	});

	it('names a root dependency that owners.ts gives no owner', () => {
		const manifest = rootManifest();
		manifest.dependencies = { ...manifest.dependencies, 'left-pad': '1.3.0' };
		expect(ownerProblems(manifest)).toEqual([
			'left-pad is a dependency of the root manifest without an owner in scripts/layout/owners.ts'
		]);
	});

	it('names an owner entry whose dependency the root manifest dropped', () => {
		const manifest = rootManifest();
		const { svix: _dropped, ...dependencies } = manifest.dependencies ?? {};
		manifest.dependencies = dependencies;
		expect(ownerProblems(manifest)).toEqual([
			'scripts/layout/owners.ts names svix, which the root manifest does not declare'
		]);
	});

	it('names a root script that owners.ts gives no owner', () => {
		const manifest = rootManifest();
		manifest.scripts = { ...manifest.scripts, 'check:new': 'bun scripts/new.ts' };
		expect(ownerProblems(manifest)).toEqual([
			'check:new is a script of the root manifest without an owner in scripts/layout/owners.ts'
		]);
	});
});

describe('staleReplacements', () => {
	it('accepts the flat files the replacements were written against', () => {
		expect(staleReplacements(read)).toEqual([]);
	});

	it('names a flat file that changed since its replacement was written', () => {
		expect(
			staleReplacements((path) => (path === 'tsconfig.json' ? `${read(path)}\n` : read(path)))
		).toEqual([
			'tsconfig.json changed since its replacement in scripts/layout/replacements.ts was written; rewrite the replacement against the new file and record its SHA-256'
		]);
	});
});

describe('moveScript', () => {
	it('names a moved path relative to the workspace the script moves to', () => {
		expect(
			moveScript(
				flat,
				'tsc -p src/lib/convex/tsconfig.json --noEmit',
				'backend',
				noScript,
				() => {}
			)
		).toBe('tsc -p convex/tsconfig.json --noEmit');
	});

	it('runs a script that another workspace owns through --filter', () => {
		const owner = (name: string) => (name === 'generate:content' ? 'backend' : 'web');
		expect(
			moveScript(flat, 'bun run generate:content && vitest --run', 'web', owner, () => {})
		).toBe('bun run --filter @repo/backend generate:content && vitest --run');
	});

	it('keeps a script that a --cwd command names in its own workspace', () => {
		expect(
			moveScript(
				flat,
				'bun run --cwd packages/create-saas-starter build',
				'create-saas-starter',
				() => 'web',
				() => {}
			)
		).toBe('bun run build');
	});

	it('reports a path that leaves the workspace', () => {
		const warnings: string[] = [];
		expect(
			moveScript(flat, 'prettier --write src/i18n/*.json', 'web', noScript, (line) =>
				warnings.push(line)
			)
		).toBe('prettier --write ../../packages/product-config/src/i18n/*.json');
		expect(warnings).toEqual([
			'web script reads ../../packages/product-config/src/i18n/*.json outside its workspace'
		]);
	});
});

describe('apply', () => {
	let directory: string | undefined;
	afterEach(() => {
		if (directory) rmSync(directory, { recursive: true, force: true });
		directory = undefined;
	});

	it('refuses a checkout with uncommitted changes and leaves it as it was', async () => {
		directory = mkdtempSync(join(tmpdir(), 'layout-apply-'));
		const git = (...args: string[]) =>
			spawnSync('git', args, { cwd: directory, encoding: 'utf8' }).status;
		expect(git('init', '--quiet')).toBe(0);
		writeFileSync(join(directory, 'package.json'), '{}\n');
		expect(git('add', 'package.json')).toBe(0);
		expect(git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'flat')).toBe(0);
		writeFileSync(join(directory, 'stray.ts'), '');
		await expect(apply(directory, () => {})).rejects.toThrow(
			'The checkout has uncommitted changes:\n?? stray.ts'
		);
		expect(readFileSync(join(directory, 'package.json'), 'utf8')).toBe('{}\n');
	});
});
