import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	assertSupportedBunVersion,
	filteredEnvironment,
	resolveBunExecutable,
	runProcess,
	runSetupAndInstall,
	setupArguments
} from '../src/process.js';
import type { ResolvedOptions } from '../src/prompts.js';

const temporaryDirectories: string[] = [];
afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
	);
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
		dryRun: false,
		...overrides
	};
}

function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitUntil(predicate: () => boolean | Promise<boolean>): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt++) {
		if (await predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error('Condition did not become true.');
}

describe('process contract', () => {
	it('filters ambient secrets and preload controls while retaining required OS values', () => {
		expect(
			filteredEnvironment({
				PATH: '/bin',
				HOME: '/home/test',
				LANG: 'en_US.UTF-8',
				APP_SECRET: 'not-forwarded',
				NODE_OPTIONS: '--require unwanted',
				BUN_CONFIG_TOKEN: 'not-forwarded'
			})
		).toEqual({ PATH: '/bin', HOME: '/home/test', LANG: 'en_US.UTF-8', HUSKY: '0' });
	});

	it('rejects a missing Bun executable before target writes', async () => {
		await expect(resolveBunExecutable({ PATH: '' }, process.platform, null)).rejects.toThrow('Bun');
	});

	it.each(['1.3.9', '1.3.10', '2.0.0'])('accepts Bun %s', (version) => {
		expect(() => assertSupportedBunVersion(version)).not.toThrow();
	});

	it.each(['1.3.8', '1.2.99', 'invalid'])('rejects Bun %s', (version) => {
		expect(() => assertSupportedBunVersion(version)).toThrow();
	});

	it('keeps setup arguments as exact argv values', () => {
		expect(
			setupArguments(
				options({
					company: 'Company & Sons',
					operator: 'Operator Name',
					address: 'Unicode Straße 1',
					email: 'local@example.test'
				})
			)
		).toEqual([
			'run',
			'setup',
			'--slug',
			'project',
			'--repo',
			'owner/project',
			'--brand',
			'Quoted " Project',
			'--company',
			'Company & Sons',
			'--operator',
			'Operator Name',
			'--address',
			'Unicode Straße 1',
			'--email',
			'local@example.test'
		]);
	});

	it('runs public setup before frozen installation and marks setup completion between them', async () => {
		const events: string[] = [];
		const run = vi.fn<typeof runProcess>(async (command) => {
			events.push(command.args.join(' '));
			return { code: 0, stdout: '', stderr: '' };
		});
		await expect(
			runSetupAndInstall({
				bun: '/bin/bun',
				environment: { PATH: '/bin', HUSKY: '0' },
				target: '/target',
				options: options(),
				signal: new AbortController().signal,
				onSetupComplete: async () => {
					events.push('setup-complete');
				},
				run
			})
		).resolves.toBe('ready');
		expect(events).toEqual([
			'run setup --slug project --repo owner/project --brand Quoted " Project',
			'setup-complete',
			'install --frozen-lockfile'
		]);
	});

	it('reports the failing child phase and does not skip setup', async () => {
		const setupFailure = vi
			.fn<typeof runProcess>()
			.mockResolvedValue({ code: 7, stdout: '', stderr: '' });
		await expect(
			runSetupAndInstall({
				bun: '/bin/bun',
				environment: {},
				target: '/target',
				options: options(),
				signal: new AbortController().signal,
				onSetupComplete: async () => {
					throw new Error('must not run');
				},
				run: setupFailure
			})
		).rejects.toThrow('Template setup failed with exit code 7');

		const installFailure = vi
			.fn<typeof runProcess>()
			.mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
			.mockResolvedValueOnce({ code: 9, stdout: '', stderr: '' });
		await expect(
			runSetupAndInstall({
				bun: '/bin/bun',
				environment: {},
				target: '/target',
				options: options(),
				signal: new AbortController().signal,
				onSetupComplete: async () => {},
				run: installFailure
			})
		).rejects.toThrow('Dependency installation failed with exit code 9');
	});

	it('runs setup but not install for --skip-install', async () => {
		const run = vi.fn<typeof runProcess>().mockResolvedValue({ code: 0, stdout: '', stderr: '' });
		await expect(
			runSetupAndInstall({
				bun: '/bin/bun',
				environment: {},
				target: '/target',
				options: options({ skipInstall: true }),
				signal: new AbortController().signal,
				onSetupComplete: async () => {},
				run
			})
		).resolves.toBe('needs-install');
		expect(run).toHaveBeenCalledOnce();
	});

	it('uses ignored stdin and the provided filtered environment', async () => {
		const result = await runProcess(
			{
				command: process.execPath,
				args: ['-e', 'process.stdout.write(JSON.stringify(process.env))'],
				env: { PATH: process.env.PATH, HUSKY: '0', ONLY_THIS: 'yes' }
			},
			{
				env: { PATH: process.env.PATH, HUSKY: '0', ONLY_THIS: 'yes' },
				signal: new AbortController().signal,
				capture: true
			}
		);
		const environment = JSON.parse(result.stdout);
		expect(result.code).toBe(0);
		expect(environment.ONLY_THIS).toBe('yes');
		expect(environment.APP_SECRET).toBeUndefined();
	});

	it.runIf(process.platform !== 'win32')(
		'aborts the complete POSIX process group and returns 130',
		async () => {
			const directory = await mkdtemp(path.join(tmpdir(), 'create-saas-starter-process-'));
			temporaryDirectories.push(directory);
			const pidFile = path.join(directory, 'descendant.pid');
			const script = [
				"const {spawn}=require('node:child_process')",
				"const {writeFileSync}=require('node:fs')",
				"process.on('SIGTERM',()=>{})",
				"const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'])",
				`writeFileSync(${JSON.stringify(pidFile)},String(child.pid))`,
				'setInterval(()=>{},1000)'
			].join(';');
			const controller = new AbortController();
			const running = runProcess(
				{ command: process.execPath, args: ['-e', script], env: { PATH: process.env.PATH } },
				{ env: { PATH: process.env.PATH }, signal: controller.signal, capture: true }
			);
			await waitUntil(async () => {
				try {
					return (await readFile(pidFile, 'utf8')).length > 0;
				} catch {
					return false;
				}
			});
			const descendant = Number(await readFile(pidFile, 'utf8'));
			controller.abort();
			await expect(running).resolves.toMatchObject({ code: 130 });
			await waitUntil(() => !processExists(descendant));
			expect(processExists(descendant)).toBe(false);
		},
		10_000
	);
});
