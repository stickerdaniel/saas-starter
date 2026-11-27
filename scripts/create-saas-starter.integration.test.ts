import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CliRuntime } from '../packages/create-saas-starter/src/index.js';
import {
	runProcess,
	runSetupAndInstall,
	setupArguments
} from '../packages/create-saas-starter/src/process.js';
import type { ResolvedOptions } from '../packages/create-saas-starter/src/prompts.js';
import { publishStagedTarget } from '../packages/create-saas-starter/src/target.js';
import {
	tarGz,
	validTemplateEntries
} from '../packages/create-saas-starter/test/archive-fixture.js';
import {
	removeDirectories,
	settleChildWork
} from '../packages/create-saas-starter/test/child-work.js';
import {
	argumentsForProject,
	fixtureIo,
	markerAt,
	responseFromBuffer,
	temporaryDirectories
} from '../packages/create-saas-starter/test/cli-fixture.js';

vi.setConfig({ testTimeout: process.platform === 'win32' ? 60_000 : 20_000 });

afterEach(async () => {
	await settleChildWork();
	vi.restoreAllMocks();
	await removeDirectories(temporaryDirectories);
});

function options(overrides: Partial<ResolvedOptions> = {}): ResolvedOptions {
	return {
		directory: 'project',
		slug: 'project',
		repo: 'owner/project',
		brand: 'Quoted " Project',
		yes: true,
		trustTemplate: true,
		skipInstall: false,
		withoutTests: false,
		dryRun: false,
		...overrides
	};
}

describe('process contract', () => {
	it('hands setup a value that starts with a dash in a form its flag reader accepts', () => {
		const [, , ...flags] = setupArguments(options({ brand: '--Winter', company: '-Acme' }), 2);
		const setup = path.join(import.meta.dirname, 'template-setup.ts');

		expect(spawnSync('bun', [setup, ...flags, '--help'], { encoding: 'utf8' })).toMatchObject({
			status: 0,
			stderr: ''
		});
	});
});

describe('CLI lifecycle', () => {
	it.for(['workflow', 'child'] as const)(
		'preserves incomplete setup when real %s removal fails',
		async (target, { signal }) => {
			const { parent, messages, cli } = await fixtureIo(signal);
			const root = path.resolve(import.meta.dirname, '..');
			const fixture = path.join(root, 'scripts/__fixtures__/template-setup');
			const canonical = [
				'package.json',
				'bun.lock',
				'README.md',
				'wrangler.toml',
				'src/lib/config/legal.ts',
				'src/lib/config/site.ts',
				'src/lib/content/legal-content-dates.ts'
			];
			// Setup runs and imports these live files.
			const live = ['scripts/template-setup.ts', 'src/lib/content/legal-metadata.ts'];
			const entries = validTemplateEntries().map((entry) => {
				const relative = entry.path.slice('root/'.length);
				if (canonical.includes(relative))
					return { ...entry, data: readFileSync(path.join(fixture, relative)) };
				if (live.includes(relative))
					return { ...entry, data: readFileSync(path.join(root, relative)) };
				return entry;
			});
			// Setup imports or rebrands these live files, so it needs them before reaching the faulted removal.
			for (const relative of [
				'scripts/export-profile.ts',
				'scripts/path-sets.ts',
				'static/manifest.webmanifest',
				'src/app.html'
			]) {
				entries.push({
					path: `root/${relative}`,
					data: readFileSync(path.join(root, relative))
				});
			}
			entries.push(
				{ path: 'root/.github/workflows/create-saas-starter.yml', data: 'name: creator\n' },
				{
					path: 'root/packages/create-saas-starter/package.json',
					data: '{"name":"create-saas-starter"}\n'
				},
				{
					path: 'root/packages/create-saas-starter/src/index.ts',
					data: 'export const creator = true;\n'
				}
			);
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(responseFromBuffer(tarGz(entries)));
			const preload = path.join(parent, `fault-${target}.mjs`);
			const receipt = `CREATOR_REMOVAL_FAULT_${target}`;
			await writeFile(
				preload,
				`import { mock } from 'bun:test';\nimport * as fs from 'node:fs';\nconst original = fs.${target === 'workflow' ? 'unlinkSync' : 'rmSync'};\nmock.module('fs', () => ({ ...fs, ${target === 'workflow' ? 'unlinkSync' : 'rmSync'}(file, ...args) {\n if (String(file).replaceAll('\\\\', '/').endsWith('${target === 'workflow' ? '/.github/workflows/create-saas-starter.yml' : '/packages/create-saas-starter'}')) { console.error('${receipt}'); throw new Error('${receipt}'); }\n return original(file, ...args);\n} }));\n`
			);
			let recovery: string | undefined;
			let installs = 0;
			let publications = 0;
			let faultHit = false;
			const runtime: Partial<CliRuntime> = {
				runSetupAndInstall: async (input) => {
					recovery = input.target;
					return await runSetupAndInstall({
						...input,
						run: async (command, options) => {
							if (command.args[0] !== 'run') {
								installs++;
								throw new Error('Install reached');
							}
							const result = await runProcess(
								{ ...command, env: { ...command.env, BUN_OPTIONS: `--preload=${preload}` } },
								{
									...options,
									capture: true,
									env: { ...options.env, BUN_OPTIONS: `--preload=${preload}` }
								}
							);
							faultHit = result.stderr.includes(receipt);
							return result;
						}
					});
				},
				publishStagedTarget: async (...input) => {
					publications++;
					return await publishStagedTarget(...input);
				}
			};
			await expect(cli(argumentsForProject(), runtime)).resolves.toBe(1);
			expect(faultHit).toBe(true);
			expect(installs).toBe(0);
			expect(publications).toBe(0);
			expect(recovery).toBeDefined();
			await expect(markerAt(recovery!)).resolves.toMatchObject({
				state: 'incomplete',
				phase: 'setup'
			});
			const generated = JSON.parse(
				await readFile(path.join(recovery!, 'package.json'), 'utf8')
			) as { scripts: Record<string, string> };
			expect(generated.scripts).not.toHaveProperty('install:cli');
			expect(messages.some((message) => message.startsWith('Created '))).toBe(false);
			await expect(lstat(path.join(parent, 'project'))).rejects.toMatchObject({ code: 'ENOENT' });
		}
	);
});
