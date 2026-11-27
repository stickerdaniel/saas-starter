import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertSupportedNodeVersion, type CliRuntime } from '../src/index.js';
import { DEFAULT_TEMPLATE_SHA } from '../src/options.js';
import { createStagingTarget, publishStagedTarget, updateMarker } from '../src/target.js';
import { runSetupAndInstall } from '../src/process.js';
import {
	changedEntries,
	tarGz,
	validTemplateEntries,
	workspaceManifest,
	workspaceTemplateEntries,
	type TarFixtureEntry
} from './archive-fixture.js';
import { removeDirectories, settleChildWork } from './child-work.js';
import {
	argumentsForProject,
	fixtureIo,
	markerAt,
	responseFromBuffer,
	temporaryDirectories
} from './cli-fixture.js';

afterEach(async () => {
	await settleChildWork();
	vi.restoreAllMocks();
	await removeDirectories(temporaryDirectories);
});

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
		expect(messages.join('\n')).toContain(
			'declares templateSetupVersion 1, and create-saas-starter'
		);
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

/** Keeps staging inside `parent`, so the test removes only the directory it created. */
function stagingIn(parent: string): Partial<CliRuntime> {
	return {
		createStagingTarget: (target, marker, signal, options) =>
			createStagingTarget(target, marker, signal, { ...options, root: parent })
	};
}

describe('template profiles', () => {
	/** Runs the CLI with fake setup and install children and records what they received. */
	async function runProfile(
		signal: AbortSignal,
		entries: TarFixtureEntry[],
		args: string[],
		given: { setup?: number; install?: number; company?: string } = {}
	) {
		const { parent, messages, cli } = await fixtureIo(signal);
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
			...stagingIn(parent),
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

	it('leaves the test suite out with --without-tests and hands setup the extracted files', async ({
		signal
	}) => {
		const run = await runProfile(signal, templateWithProfiles('["tests"]'), ['--without-tests']);

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
	});

	it.for([
		{ label: 'with templateProfiles', profiles: '["tests"]' },
		{ label: 'without templateProfiles', profiles: undefined }
	])(
		'creates the full project by default for a template $label',
		async ({ profiles }, { signal }) => {
			const run = await runProfile(signal, templateWithProfiles(profiles), []);

			expect(run.code).toBe(0);
			expect(run.setup).not.toContain('--without-tests');
			expect(run.setup.filter((argument) => argument.startsWith('--archive-files'))).toEqual([]);
			expect(run.installs).toEqual([['install', '--frozen-lockfile']]);
			expect(run.messages.filter((message) => message.includes('test suite'))).toEqual([]);
		}
	);

	it.for([
		{ label: 'without templateProfiles', profiles: undefined },
		{ label: 'with an empty templateProfiles', profiles: '[]' }
	])(
		'refuses --without-tests for a template $label before any write and names the revision',
		async ({ profiles }, { signal }) => {
			const { parent, messages, cli } = await fixtureIo(signal);
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				responseFromBuffer(tarGz(templateWithProfiles(profiles)))
			);
			const createStagingTarget = vi.fn(async () => 'unused');

			await expect(
				cli(argumentsForProject(['--without-tests']), { createStagingTarget })
			).resolves.toBe(1);
			expect(createStagingTarget).not.toHaveBeenCalled();
			await expect(readdir(parent)).resolves.toEqual([]);
			expect(messages).toEqual([
				`Error: Template revision ${DEFAULT_TEMPLATE_SHA} cannot leave out the test suite: its package.json has no "tests" in templateProfiles.`
			]);
		}
	);

	it.for([
		{
			label: 'without the test suite, and keeps the list',
			args: ['--without-tests'],
			heading: 'To repeat setup without the test suite, run these commands:'
		},
		{ label: 'with the test suite', args: [], heading: 'To repeat setup, run these commands:' }
	])(
		'prints the commands that repeat a failed setup $label',
		async ({ args, heading }, { signal }) => {
			const run = await runProfile(signal, templateWithProfiles('["tests"]'), args, {
				setup: 1,
				company: "O'Neil & Co"
			});

			expect(run.code).toBe(1);
			expect(run.installs).toEqual([]);
			if (run.list !== undefined)
				await expect(readFile(run.list, 'utf8')).resolves.toContain('src/example.test.ts');
			expect(run.setup.includes('--without-tests')).toBe(run.list !== undefined);
			const at = run.messages.indexOf(heading);
			const [navigation, command] = run.messages.slice(at + 1);
			expect(at).not.toBe(-1);
			expect(run.setup).toContain("--company=O'Neil & Co");
			if (process.platform === 'win32') {
				expect(navigation).toBe(`Set-Location -LiteralPath '${run.staging}'`);
				expect(command).toMatch(/^bun run setup --slug=project /);
				expect(command).toContain(" '--company=O''Neil & Co' ");
				expect(command?.endsWith(` --without-tests '--archive-files=${run.list}'`)).toBe(
					run.list !== undefined
				);
			} else {
				const typed = (line: string) =>
					execFileSync('sh', ['-c', `printf '%s\\0' ${line}`], { encoding: 'utf8' })
						.split('\0')
						.slice(0, -1);
				expect(typed(navigation!)).toEqual(['cd', run.staging]);
				expect(typed(command!)).toEqual(['bun', ...run.setup]);
			}
		}
	);

	it('prints no install command when publication fails', async ({ signal }) => {
		const { parent, messages, cli } = await fixtureIo(signal);
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			responseFromBuffer(tarGz(templateWithProfiles('["tests"]')))
		);

		const code = await cli(argumentsForProject(['--without-tests']), {
			...stagingIn(parent),
			runSetupAndInstall: async (input) => {
				await input.onSetupComplete();
				return 'ready';
			},
			publishStagedTarget: async () => {
				throw new Error('The target could not be published.');
			}
		});

		expect(code).toBe(1);
		expect(messages).toContain('Error: The target could not be published.');
		expect(messages.filter((message) => message.startsWith('bun '))).toEqual([]);
	});

	it.for([
		{
			label: 'the two install commands after a project without tests',
			args: ['--without-tests'],
			heading: 'Setup left out the test suite. To install the dependencies, run these commands:',
			commands: ['bun install', 'bun install --frozen-lockfile']
		},
		{
			label: 'the frozen install command after a project with tests',
			args: [],
			heading: 'To install the dependencies, run these commands:',
			commands: ['bun install --frozen-lockfile']
		}
	])('prints $label failed to install', async ({ args, heading, commands }, { signal }) => {
		const run = await runProfile(signal, templateWithProfiles('["tests"]'), args, { install: 1 });

		expect(run.code).toBe(1);
		const at = run.messages.indexOf(heading);
		expect(at).not.toBe(-1);
		expect(run.messages.slice(at + 2)).toEqual(commands);
		expect(run.messages.filter((message) => message.startsWith('bun '))).toEqual(commands);
	});

	it.for([
		{
			label: 'without tests and --skip-install',
			args: ['--skip-install', '--without-tests'],
			lines: [
				'Run bun install before starting the app.',
				'Then run bun install --frozen-lockfile to check the lockfile.'
			]
		},
		{
			label: 'with tests and --skip-install',
			args: ['--skip-install'],
			lines: ['Run bun install --frozen-lockfile before starting the app.']
		},
		{ label: 'without tests after its installs', args: ['--without-tests'], lines: [] },
		{ label: 'with tests after its install', args: [], lines: [] }
	])('prints the install commands a project $label needs', async ({ args, lines }, { signal }) => {
		const run = await runProfile(signal, templateWithProfiles('["tests"]'), args);

		expect(run.code).toBe(0);
		expect(run.messages.filter((message) => message.includes('bun install'))).toEqual(lines);
	});

	it.for([
		{ label: 'without the test suite', args: ['--without-tests'] },
		{ label: 'with the test suite', args: [] }
	])(
		'hands a version 3 setup its flags and reconciles the lockfile $label',
		async ({ args }, { signal }) => {
			const entries = changedEntries(workspaceTemplateEntries(), {
				'package.json': workspaceManifest({ templateProfiles: ['tests'] })
			});
			const run = await runProfile(signal, entries, args);

			expect(run.code).toBe(0);
			expect(run.setup.filter((argument) => argument.startsWith('--without-tests'))).toEqual(
				run.list === undefined ? [] : ['--without-tests']
			);
			if (run.list !== undefined) {
				expect(run.setup.slice(-2)).toEqual(['--without-tests', `--archive-files=${run.list}`]);
				expect(run.listed).toEqual(
					expect.arrayContaining(['apps/web/wrangler.toml', 'packages/ui/package.json'])
				);
			}
			expect(run.installs).toEqual([['install'], ['install', '--frozen-lockfile']]);
		}
	);

	it.for([
		{
			label: 'the moved tree under templateSetupVersion 2',
			changes: { 'package.json': workspaceManifest({ templateSetupVersion: 2 }) },
			expected: 'public setup requires regular file wrangler.toml for templateSetupVersion 2'
		},
		{
			label: 'no packages/ui/package.json',
			changes: { 'packages/ui/package.json': undefined },
			expected: 'templateSetupVersion 3 declares @repo/ui as workspace:* in apps/web/package.json'
		},
		{
			label: 'no generated Convex bindings',
			changes: { 'packages/backend/convex/_generated/api.d.ts': undefined },
			expected:
				'public setup requires regular file packages/backend/convex/_generated/api.d.ts for templateSetupVersion 3'
		},
		{
			label: 'templateSetupVersion 4',
			changes: { 'package.json': workspaceManifest({ templateSetupVersion: 4 }) },
			expected: 'declares templateSetupVersion 4'
		},
		{
			label: 'no member below apps/',
			changes: { 'apps/web/package.json': undefined },
			expected: 'declares the workspace pattern apps/*, and no directory directly below apps/'
		},
		{
			label: 'a workspace pattern that names the creator',
			changes: {
				'package.json': workspaceManifest({
					workspaces: ['apps/*', 'packages/*', 'packages/create-saas-starter']
				})
			},
			expected:
				'templateSetupVersion 3 declares the workspace pattern packages/create-saas-starter, which lies in packages/create-saas-starter, and setup removes that directory.'
		}
	])(
		'refuses an archive with $label before staging and writes no file',
		async ({ changes, expected }, { signal }) => {
			const { parent, messages, cli } = await fixtureIo(signal);
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				responseFromBuffer(tarGz(changedEntries(workspaceTemplateEntries(), changes)))
			);
			const createStagingTarget = vi.fn(async () => 'unused');

			await expect(cli(argumentsForProject(), { createStagingTarget })).resolves.toBe(1);
			expect(createStagingTarget).not.toHaveBeenCalled();
			await expect(readdir(parent)).resolves.toEqual([]);
			expect(messages.join('\n')).toContain(expected);
			expect(messages.join('\n')).toContain(DEFAULT_TEMPLATE_SHA);
		}
	);
});
