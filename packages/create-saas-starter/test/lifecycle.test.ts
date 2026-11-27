import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	rmdir,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertSupportedNodeVersion, runCli, type CliIo, type CliRuntime } from '../src/index.js';
import { SCAFFOLD_MARKER } from '../src/archive.js';
import { DEFAULT_TEMPLATE_SHA } from '../src/options.js';
import { publishStagedTarget, updateMarker } from '../src/target.js';
import { runProcess, runSetupAndInstall } from '../src/process.js';
import { tarGz, validTemplateEntries, type TarFixtureEntry } from './archive-fixture.js';
import { cliChildWork, removeDirectories, settleChildWork } from './child-work.js';

const temporaryDirectories: string[] = [];
afterEach(async () => {
	await settleChildWork();
	vi.restoreAllMocks();
	await removeDirectories(temporaryDirectories);
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
		'--street',
		'1 Main Street',
		'--postal-code',
		'12345',
		'--city',
		'City',
		'--country',
		'US',
		'--email',
		'contact@example.test',
		'--yes',
		'--trust-template',
		...extra
	];
}

/** Every run here starts real Bun children, so `cli` binds the run to the test's signal. */
async function fixtureIo(signal: AbortSignal): Promise<{
	parent: string;
	messages: string[];
	interrupts: EventEmitter;
	cli: (args: string[], runtime: Partial<CliRuntime>) => Promise<number>;
}> {
	const parent = await mkdtemp(path.join(tmpdir(), 'create-saas-starter-late-abort-'));
	temporaryDirectories.push(parent);
	const messages: string[] = [];
	const interrupts = new EventEmitter();
	const io: CliIo = {
		stdout: (message) => messages.push(message),
		stderr: (message) => messages.push(message),
		stdin: process.stdin,
		environment: process.env,
		cwd: parent,
		interrupts
	};
	return {
		parent,
		messages,
		interrupts,
		cli: (args, runtime) => cliChildWork(signal, interrupts, () => runCli(args, io, runtime))
	};
}

async function markerAt(target: string): Promise<{ state: string; phase: string }> {
	return JSON.parse(await readFile(path.join(target, SCAFFOLD_MARKER), 'utf8')) as {
		state: string;
		phase: string;
	};
}

describe('Node.js version gate', () => {
	it.each(['21.9.0', '22.16.1'])('refuses Node.js %s', (version) => {
		expect(() => assertSupportedNodeVersion(version)).toThrow(
			'Node.js 22.17.0 or newer is required.'
		);
	});

	it.each(['22.17.0', '24.21.0'])('accepts Node.js %s', (version) => {
		expect(() => assertSupportedNodeVersion(version)).not.toThrow();
	});
});

describe('CLI lifecycle', () => {
	it.for(['workflow', 'child'] as const)(
		'preserves incomplete setup when real %s removal fails',
		async (target, { signal }) => {
			const { parent, messages, cli } = await fixtureIo(signal);
			const root = path.resolve(import.meta.dirname, '../../..');
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

	it.for([
		{ label: 'the default pin', args: [] },
		{ label: 'an explicit ref', args: ['--ref', 'release'] }
	])('rejects a protocol 1 template from $label before staging', async ({ args }, { signal }) => {
		const { parent, messages, cli } = await fixtureIo(signal);
		const protocolOne = validTemplateEntries().map((entry) =>
			entry.path === 'root/package.json'
				? {
						...entry,
						data: '{"templateSetupVersion":1,"scripts":{"setup":"bun scripts/template-setup.ts"}}'
					}
				: entry
		);
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
			new URL(String(input)).hostname === 'api.github.com'
				? new Response(JSON.stringify({ sha: 'b'.repeat(40) }))
				: responseFromBuffer(tarGz(protocolOne))
		);
		const createStagingTarget = vi.fn(async () => 'unused');

		await expect(cli(argumentsForProject(args), { createStagingTarget })).resolves.toBe(1);
		expect(createStagingTarget).not.toHaveBeenCalled();
		await expect(lstat(path.join(parent, 'project'))).rejects.toMatchObject({ code: 'ENOENT' });
		expect(messages.join('\n')).toContain('templateSetupVersion:2');
	});

	it('reminds about legal values only while an identity field is missing', async ({ signal }) => {
		const complete = await fixtureIo(signal);
		await expect(complete.cli(argumentsForProject(['--dry-run']), {})).resolves.toBe(0);
		expect(complete.messages.join('\n')).toContain('Dry run complete.');
		expect(complete.messages.join('\n')).not.toContain('Review the generated legal identity');

		const withoutCountry = await fixtureIo(signal);
		const args = argumentsForProject(['--dry-run']);
		args.splice(args.indexOf('--country'), 2);
		await expect(withoutCountry.cli(args, {})).resolves.toBe(0);
		expect(withoutCountry.messages.join('\n')).toContain('Review the generated legal identity');
	});

	it('rejects an overlong materialized path before claiming the target', async ({ signal }) => {
		const { parent, messages, cli } = await fixtureIo(signal);
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			responseFromBuffer(
				tarGz([
					...validTemplateEntries(),
					{ path: `root/${'a'.repeat(255)}`, data: 'too long for a portable absolute path' }
				])
			)
		);
		const createStagingTarget = vi.fn(async () => 'unused');

		await expect(cli(argumentsForProject(), { createStagingTarget })).resolves.toBe(1);
		expect(createStagingTarget).not.toHaveBeenCalled();
		await expect(lstat(path.join(parent, 'project'))).rejects.toMatchObject({ code: 'ENOENT' });
		expect(messages.join('\n')).toMatch(/Target path is not portable.*archive file/);
	});

	it('turns an abort after setup completion into preserved incomplete state', async ({
		signal
	}) => {
		const { messages, interrupts, cli } = await fixtureIo(signal);
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

		await expect(cli(argumentsForProject(['--skip-install']), runtime)).resolves.toBe(130);
		expect(recoveryPath).toBeDefined();
		await expect(markerAt(recoveryPath!)).resolves.toMatchObject({
			state: 'incomplete',
			phase: 'install'
		});
		expect(messages.some((message) => message.startsWith('Created '))).toBe(false);
		expect(messages.join('\n')).toContain(`Recovery files were preserved at ${recoveryPath}.`);
	});

	it('replaces a final ready marker with incomplete state when marker I/O is followed by abort', async ({
		signal
	}) => {
		const { messages, interrupts, cli } = await fixtureIo(signal);
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

		await expect(cli(argumentsForProject(), runtime)).resolves.toBe(130);
		expect(recoveryPath).toBeDefined();
		await expect(markerAt(recoveryPath!)).resolves.toMatchObject({
			state: 'incomplete',
			phase: 'complete'
		});
		expect(messages.some((message) => message.startsWith('Created '))).toBe(false);
		expect(messages.join('\n')).toContain(`Recovery files were preserved at ${recoveryPath}.`);
	});

	it('publishes completed staging work and reports the final target', async ({ signal }) => {
		const { parent, messages, cli } = await fixtureIo(signal);
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

		await expect(cli(argumentsForProject(['--skip-install']), runtime)).resolves.toBe(0);
		await expect(markerAt(finalTarget)).resolves.toMatchObject({
			state: 'needs-install',
			phase: 'complete'
		});
		expect(staging).toBeDefined();
		await expect(lstat(staging!)).rejects.toMatchObject({ code: 'ENOENT' });
		expect(messages).toContain(`Created Project at ${finalTarget}`);
	});

	it('warns with the retained staging path when post-commit cleanup fails', async ({ signal }) => {
		const { parent, messages, cli } = await fixtureIo(signal);
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
			publishStagedTarget: async (plan, stagingPath, publishSignal) =>
				await publishStagedTarget(plan, stagingPath, publishSignal, {
					platform: 'win32',
					cleanup: async () => {
						throw new Error('cleanup failed');
					}
				})
		};

		await expect(cli(argumentsForProject(), runtime)).resolves.toBe(0);
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

	it('treats an interrupt observed after publication as committed success', async ({ signal }) => {
		const { parent, messages, interrupts, cli } = await fixtureIo(signal);
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

		await expect(cli(argumentsForProject(), runtime)).resolves.toBe(0);
		await expect(markerAt(finalTarget)).resolves.toMatchObject({
			state: 'ready',
			phase: 'complete'
		});
		expect(messages).toContain(`Created Project at ${finalTarget}`);
		expect(messages.join('\n')).not.toContain('Recovery files');
	});

	it('never executes a project that replaces the final target before publication', async ({
		signal
	}) => {
		const { parent, messages, cli } = await fixtureIo(signal);
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

		await expect(cli(argumentsForProject(['--skip-install']), runtime)).resolves.toBe(1);
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

/** A template whose `package.json` holds `profiles`, JSON text, as `templateProfiles`. */
function templateWithProfiles(profiles?: string): TarFixtureEntry[] {
	const manifest = JSON.stringify({
		templateSetupVersion: 2,
		scripts: { setup: 'bun scripts/template-setup.ts' }
	});
	return [
		...validTemplateEntries().map((entry) =>
			entry.path === 'root/package.json'
				? {
						...entry,
						data:
							profiles === undefined
								? manifest
								: `${manifest.slice(0, -1)},"templateProfiles":${profiles}}`
					}
				: entry
		),
		{ path: 'root/src/example.test.ts', data: 'export {};' }
	];
}

const LEGACY_NOTICE = `Template revision ${DEFAULT_TEMPLATE_SHA} cannot leave out the test suite, so the project includes it.`;

describe('template profiles', () => {
	/** Runs the CLI with fake setup and install children and records what they received. */
	async function runProfile(
		signal: AbortSignal,
		entries: TarFixtureEntry[],
		args: string[],
		given: { setup?: number; install?: number; company?: string } = {}
	) {
		const { messages, cli } = await fixtureIo(signal);
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(responseFromBuffer(tarGz(entries)));
		const children: string[][] = [];
		let staging: string | undefined;
		let list: string | undefined;
		let listed: unknown;
		let listDirectory: { mode: number; entries: string[] } | undefined;
		const projectArguments = argumentsForProject(args).map((argument) =>
			argument === 'Company' ? (given.company ?? argument) : argument
		);
		const code = await cli(projectArguments, {
			runSetupAndInstall: async (input) => {
				staging = input.target;
				return await runSetupAndInstall({
					...input,
					run: async (command) => {
						children.push(command.args);
						const flag = '--archive-files=';
						const handed = command.args.find((argument) => argument.startsWith(flag));
						if (handed !== undefined) {
							list = handed.slice(flag.length);
							listed = JSON.parse(await readFile(list, 'utf8'));
							listDirectory = {
								mode: (await lstat(path.dirname(list))).mode & 0o777,
								entries: await readdir(path.dirname(list))
							};
						}
						const code = command.args[0] === 'run' ? given.setup : given.install;
						return { code: code ?? 0, stdout: '', stderr: '' };
					}
				});
			}
		});
		const [setup, ...installs] = children;
		return {
			code,
			messages,
			setup: setup!,
			installs,
			staging: staging!,
			list,
			listed,
			listDirectory
		};
	}

	it.for([
		{ label: 'a repeated name', profiles: '["tests","tests"]' },
		{ label: 'an unknown name', profiles: '["demo"]' },
		{ label: 'a string', profiles: '"tests"' },
		{ label: 'a number', profiles: '[1]' },
		{
			label: 'a list nested 12,000 deep',
			profiles: `${'['.repeat(12_000)}"tests"${']'.repeat(12_000)}`
		}
	])(
		'refuses templateProfiles with $label before staging and names the revision',
		async ({ profiles }, { signal }) => {
			const { messages, cli } = await fixtureIo(signal);
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				responseFromBuffer(tarGz(templateWithProfiles(profiles)))
			);
			const createStagingTarget = vi.fn(async () => 'unused');

			await expect(cli(argumentsForProject(), { createStagingTarget })).resolves.toBe(1);
			expect(createStagingTarget).not.toHaveBeenCalled();
			expect(messages.join('\n')).toContain(
				`Template revision ${DEFAULT_TEMPLATE_SHA} declares a templateProfiles value that create-saas-starter`
			);
		}
	);

	it('leaves the test suite out by default and hands setup the extracted files', async ({
		signal
	}) => {
		const run = await runProfile(signal, templateWithProfiles('["tests"]'), []);

		expect(run.code).toBe(0);
		expect(run.setup.slice(-2)).toEqual(['--without-tests', `--archive-files=${run.list}`]);
		expect(path.relative(run.staging, run.list!)).toMatch(/^\.\.[\\/]/);
		expect(run.listDirectory?.entries).toEqual([path.basename(run.list!)]);
		if (process.platform !== 'win32') expect(run.listDirectory?.mode).toBe(0o700);
		expect(run.listed).toEqual([
			'package.json',
			'bun.lock',
			'scripts/template-setup.ts',
			'wrangler.toml',
			'README.md',
			'src/lib/config/site.ts',
			'src/lib/config/legal.ts',
			'src/lib/content/legal-content-dates.ts',
			'src/lib/content/legal-metadata.ts',
			'AGENTS.md',
			'.agents/skills/example/SKILL.md',
			'scripts/executable.ts',
			'src/example.test.ts',
			'CLAUDE.md',
			'.claude/skills/example/SKILL.md'
		]);
		expect(run.installs).toEqual([['install'], ['install', '--frozen-lockfile']]);
		await expect(lstat(path.dirname(run.list!))).rejects.toMatchObject({ code: 'ENOENT' });
		expect(run.messages).not.toContain(LEGACY_NOTICE);
	});

	it.for([
		{ label: 'a template without templateProfiles', profiles: undefined, args: [], notice: true },
		{ label: '--with-tests', profiles: '["tests"]', args: ['--with-tests'], notice: false }
	])('creates the full project for $label', async ({ profiles, args, notice }, { signal }) => {
		const run = await runProfile(signal, templateWithProfiles(profiles), args);

		expect(run.code).toBe(0);
		expect(run.setup).not.toContain('--without-tests');
		expect(run.setup.filter((argument) => argument.startsWith('--archive-files'))).toEqual([]);
		expect(run.installs).toEqual([['install', '--frozen-lockfile']]);
		expect(run.messages.filter((message) => message === LEGACY_NOTICE)).toHaveLength(
			notice ? 1 : 0
		);
	});

	it('keeps the list after a failed setup and prints the commands that repeat setup', async ({
		signal
	}) => {
		const run = await runProfile(signal, templateWithProfiles('["tests"]'), [], {
			setup: 1,
			company: "O'Neil & Co"
		});

		expect(run.code).toBe(1);
		expect(run.installs).toEqual([]);
		await expect(readFile(run.list!, 'utf8')).resolves.toContain('src/example.test.ts');
		temporaryDirectories.push(run.staging);
		await rm(run.list!);
		await rmdir(path.dirname(run.list!));
		const heading = run.messages.indexOf(
			'To repeat setup without the test suite, run these commands:'
		);
		const [navigation, command] = run.messages.slice(heading + 1);
		expect(heading).not.toBe(-1);
		expect(run.setup).toContain("--company=O'Neil & Co");
		if (process.platform === 'win32') {
			expect(navigation).toBe(`Set-Location -LiteralPath '${run.staging}'`);
			expect(command).toMatch(/^bun run setup --slug=project /);
			expect(command).toContain(" '--company=O''Neil & Co' ");
			expect(command?.endsWith(` --without-tests '--archive-files=${run.list}'`)).toBe(true);
		} else {
			const typed = (line: string) =>
				execFileSync('sh', ['-c', `printf '%s\\0' ${line}`], { encoding: 'utf8' })
					.split('\0')
					.slice(0, -1);
			expect(typed(navigation!)).toEqual(['cd', run.staging]);
			expect(typed(command!)).toEqual(['bun', ...run.setup]);
		}
	});

	it('prints no install command when publication fails', async ({ signal }) => {
		const { messages, cli } = await fixtureIo(signal);
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			responseFromBuffer(tarGz(templateWithProfiles('["tests"]')))
		);
		let staging: string | undefined;

		const code = await cli(argumentsForProject(), {
			runSetupAndInstall: async (input) => {
				staging = input.target;
				await input.onSetupComplete();
				return 'ready';
			},
			publishStagedTarget: async () => {
				throw new Error('The target could not be published.');
			}
		});

		expect(code).toBe(1);
		temporaryDirectories.push(staging!);
		expect(messages).toContain('Error: The target could not be published.');
		expect(messages.filter((message) => message.startsWith('bun '))).toEqual([]);
	});

	it.for([
		{
			label: 'the two install commands after a project without tests',
			args: [],
			commands: ['bun install', 'bun install --frozen-lockfile']
		},
		{ label: 'no install command after a project with tests', args: ['--with-tests'], commands: [] }
	])('prints $label failed to install', async ({ args, commands }, { signal }) => {
		const run = await runProfile(signal, templateWithProfiles('["tests"]'), args, { install: 1 });

		expect(run.code).toBe(1);
		temporaryDirectories.push(run.staging);
		expect(run.messages.filter((message) => message.startsWith('bun '))).toEqual(commands);
		expect(
			run.messages.includes(
				'Setup left out the test suite. To install the dependencies, run these commands:'
			)
		).toBe(commands.length > 0);
	});

	it.for([
		{
			label: 'without tests and --skip-install',
			args: ['--skip-install'],
			lines: [
				'Run bun install before starting the app.',
				'Then run bun install --frozen-lockfile to check the lockfile.'
			]
		},
		{
			label: 'with tests and --skip-install',
			args: ['--skip-install', '--with-tests'],
			lines: ['Run bun install --frozen-lockfile before starting the app.']
		},
		{ label: 'without tests after its installs', args: [], lines: [] },
		{ label: 'with tests after its install', args: ['--with-tests'], lines: [] }
	])('prints the install commands a project $label needs', async ({ args, lines }, { signal }) => {
		const run = await runProfile(signal, templateWithProfiles('["tests"]'), args);

		expect(run.code).toBe(0);
		expect(run.messages.filter((message) => message.includes('bun install'))).toEqual(lines);
	});
});
