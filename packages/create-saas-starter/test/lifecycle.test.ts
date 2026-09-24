import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli, type CliIo, type CliRuntime } from '../src/index.js';
import { SCAFFOLD_MARKER } from '../src/archive.js';
import { publishStagedTarget, updateMarker } from '../src/target.js';
import { runProcess, runSetupAndInstall } from '../src/process.js';
import { tarGz, validTemplateEntries } from './archive-fixture.js';

const temporaryDirectories: string[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
	);
});

function responseFromBuffer(buffer: Buffer): Response {
	const body = buffer.buffer.slice(
		buffer.byteOffset,
		buffer.byteOffset + buffer.byteLength
	) as ArrayBuffer;
	return new Response(body);
}

function argumentsForProject(extra: string[] = []): string[] {
	return [
		'project',
		'--slug',
		'project',
		'--repo',
		'owner/project',
		'--brand',
		'Project',
		'--company',
		'Company',
		'--operator',
		'Operator',
		'--address',
		'Address',
		'--email',
		'contact@example.test',
		'--yes',
		'--trust-template',
		...extra
	];
}

async function fixtureIo(): Promise<{
	parent: string;
	messages: string[];
	interrupts: EventEmitter;
	io: CliIo;
}> {
	const parent = await mkdtemp(path.join(tmpdir(), 'create-saas-starter-late-abort-'));
	temporaryDirectories.push(parent);
	const messages: string[] = [];
	const interrupts = new EventEmitter();
	return {
		parent,
		messages,
		interrupts,
		io: {
			stdout: (message) => messages.push(message),
			stderr: (message) => messages.push(message),
			stdin: process.stdin,
			environment: process.env,
			cwd: parent,
			interrupts
		}
	};
}

async function markerAt(target: string): Promise<{ state: string; phase: string }> {
	return JSON.parse(await readFile(path.join(target, SCAFFOLD_MARKER), 'utf8')) as {
		state: string;
		phase: string;
	};
}

describe('CLI lifecycle', () => {
	it.each(['workflow', 'child'] as const)(
		'preserves incomplete setup when real %s removal fails',
		async (target) => {
			const { parent, messages, io } = await fixtureIo();
			const root = path.resolve(import.meta.dirname, '../../..');
			const fixture = path.join(root, 'scripts/__fixtures__/template-setup');
			const canonical = [
				'package.json',
				'bun.lock',
				'README.md',
				'wrangler.toml',
				'src/lib/config/legal.ts',
				'src/lib/config/site.ts',
				'src/lib/content/legal-metadata.ts'
			];
			const entries = validTemplateEntries().map((entry) => {
				const relative = entry.path.slice('root/'.length);
				if (canonical.includes(relative))
					return { ...entry, data: readFileSync(path.join(fixture, relative)) };
				if (relative === 'scripts/template-setup.ts')
					return { ...entry, data: readFileSync(path.join(root, relative)) };
				return entry;
			});
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
			await expect(runCli(argumentsForProject(), io, runtime)).resolves.toBe(1);
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

	it('rejects an overlong materialized path before claiming the target', async () => {
		const { parent, messages, io } = await fixtureIo();
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			responseFromBuffer(
				tarGz([
					...validTemplateEntries(),
					{ path: `root/${'a'.repeat(255)}`, data: 'too long for a portable absolute path' }
				])
			)
		);
		const createStagingTarget = vi.fn(async () => 'unused');

		await expect(runCli(argumentsForProject(), io, { createStagingTarget })).resolves.toBe(1);
		expect(createStagingTarget).not.toHaveBeenCalled();
		await expect(lstat(path.join(parent, 'project'))).rejects.toMatchObject({ code: 'ENOENT' });
		expect(messages.join('\n')).toMatch(/Target path is not portable.*archive file/);
	});

	it('turns an abort after setup completion into preserved incomplete state', async () => {
		const { messages, interrupts, io } = await fixtureIo();
		let recoveryPath: string | undefined;
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			responseFromBuffer(tarGz(validTemplateEntries()))
		);
		const runtime: Partial<CliRuntime> = {
			updateMarker,
			runSetupAndInstall: async (input) => {
				recoveryPath = input.target;
				await input.onSetupComplete();
				interrupts.emit('SIGINT');
				interrupts.emit('SIGINT');
				return 'needs-install';
			}
		};

		await expect(runCli(argumentsForProject(['--skip-install']), io, runtime)).resolves.toBe(130);
		expect(recoveryPath).toBeDefined();
		await expect(markerAt(recoveryPath!)).resolves.toMatchObject({
			state: 'incomplete',
			phase: 'install'
		});
		expect(messages.some((message) => message.startsWith('Created '))).toBe(false);
		expect(messages.join('\n')).toContain(`Recovery files were preserved at ${recoveryPath}.`);
	});

	it('replaces a final ready marker with incomplete state when marker I/O is followed by abort', async () => {
		const { messages, interrupts, io } = await fixtureIo();
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			responseFromBuffer(tarGz(validTemplateEntries()))
		);
		let recoveryPath: string | undefined;
		let interrupted = false;
		const runtime: Partial<CliRuntime> = {
			runSetupAndInstall: async (input) => {
				recoveryPath = input.target;
				await input.onSetupComplete();
				return 'ready';
			},
			updateMarker: async (...input) => {
				if (!interrupted && input[2] === 'ready' && input[3] === 'complete') {
					interrupted = true;
					interrupts.emit('SIGINT');
					interrupts.emit('SIGINT');
				}
				return await updateMarker(...input);
			}
		};

		await expect(runCli(argumentsForProject(), io, runtime)).resolves.toBe(130);
		expect(recoveryPath).toBeDefined();
		await expect(markerAt(recoveryPath!)).resolves.toMatchObject({
			state: 'incomplete',
			phase: 'complete'
		});
		expect(messages.some((message) => message.startsWith('Created '))).toBe(false);
		expect(messages.join('\n')).toContain(`Recovery files were preserved at ${recoveryPath}.`);
	});

	it('publishes completed staging work and reports the final target', async () => {
		const { parent, messages, io } = await fixtureIo();
		const finalTarget = path.join(await realpath(parent), 'project');
		let staging: string | undefined;
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			responseFromBuffer(tarGz(validTemplateEntries()))
		);
		const runtime: Partial<CliRuntime> = {
			runSetupAndInstall: async (input) => {
				staging = input.target;
				await input.onSetupComplete();
				return 'needs-install';
			}
		};

		await expect(runCli(argumentsForProject(['--skip-install']), io, runtime)).resolves.toBe(0);
		await expect(markerAt(finalTarget)).resolves.toMatchObject({
			state: 'needs-install',
			phase: 'complete'
		});
		expect(staging).toBeDefined();
		await expect(lstat(staging!)).rejects.toMatchObject({ code: 'ENOENT' });
		expect(messages).toContain(`Created Project at ${finalTarget}`);
	});

	it('warns with the retained staging path when post-commit cleanup fails', async () => {
		const { parent, messages, io } = await fixtureIo();
		const finalTarget = path.join(await realpath(parent), 'project');
		let staging: string | undefined;
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			responseFromBuffer(tarGz(validTemplateEntries()))
		);
		const runtime: Partial<CliRuntime> = {
			runSetupAndInstall: async (input) => {
				staging = input.target;
				await input.onSetupComplete();
				return 'ready';
			},
			publishStagedTarget: async (plan, stagingPath, signal) =>
				await publishStagedTarget(plan, stagingPath, signal, {
					platform: 'win32',
					cleanup: async () => {
						throw new Error('cleanup failed');
					}
				})
		};

		await expect(runCli(argumentsForProject(), io, runtime)).resolves.toBe(0);
		await expect(markerAt(finalTarget)).resolves.toMatchObject({
			state: 'ready',
			phase: 'complete'
		});
		expect(staging).toBeDefined();
		expect(await lstat(staging!)).toBeDefined();
		expect(messages).toContain(
			`Warning: The project was created successfully, but staging files remain at ${staging}.`
		);
		expect(messages.join('\n')).not.toContain('Recovery files');
	});

	it('treats an interrupt observed after publication as committed success', async () => {
		const { parent, messages, interrupts, io } = await fixtureIo();
		const finalTarget = path.join(await realpath(parent), 'project');
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			responseFromBuffer(tarGz(validTemplateEntries()))
		);
		const runtime: Partial<CliRuntime> = {
			runSetupAndInstall: async (input) => {
				await input.onSetupComplete();
				return 'ready';
			},
			publishStagedTarget: async (...input) => {
				const result = await publishStagedTarget(...input);
				interrupts.emit('SIGINT');
				return result;
			}
		};

		await expect(runCli(argumentsForProject(), io, runtime)).resolves.toBe(0);
		await expect(markerAt(finalTarget)).resolves.toMatchObject({
			state: 'ready',
			phase: 'complete'
		});
		expect(messages).toContain(`Created Project at ${finalTarget}`);
		expect(messages.join('\n')).not.toContain('Recovery files');
	});

	it('never executes a project that replaces the final target before publication', async () => {
		const { parent, messages, io } = await fixtureIo();
		const finalTarget = path.join(await realpath(parent), 'project');
		const attackMarker = path.join(parent, 'attack-ran');
		let recoveryPath: string | undefined;
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			responseFromBuffer(tarGz(validTemplateEntries()))
		);
		const runtime: Partial<CliRuntime> = {
			runSetupAndInstall: async (input) => {
				recoveryPath = input.target;
				expect(input.target).not.toBe(finalTarget);
				await mkdir(finalTarget);
				await writeFile(
					path.join(finalTarget, 'package.json'),
					JSON.stringify({
						scripts: {
							setup: `node -e "require('node:fs').writeFileSync(${JSON.stringify(attackMarker)}, '')"`
						}
					})
				);
				await input.onSetupComplete();
				return 'needs-install';
			}
		};

		await expect(runCli(argumentsForProject(['--skip-install']), io, runtime)).resolves.toBe(1);
		expect(recoveryPath).toBeDefined();
		await expect(markerAt(recoveryPath!)).resolves.toMatchObject({
			state: 'incomplete',
			phase: 'complete'
		});
		await expect(lstat(attackMarker)).rejects.toMatchObject({ code: 'ENOENT' });
		expect(
			JSON.parse(await readFile(path.join(finalTarget, 'package.json'), 'utf8'))
		).toMatchObject({
			scripts: { setup: expect.stringContaining('attack-ran') }
		});
		expect(messages.join('\n')).toContain(`Recovery files were preserved at ${recoveryPath}.`);
	});
});
