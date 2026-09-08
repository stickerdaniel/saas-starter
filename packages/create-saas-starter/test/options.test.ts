import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import * as clack from '@clack/prompts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listenForInterrupt, runCli } from '../src/index.js';
import { deriveSlug, parseCliOptions, validateProvidedValues } from '../src/options.js';
import {
	confirmTemplateTrust,
	PromptCancelledError,
	resolveOptions,
	type PromptAdapter
} from '../src/prompts.js';
import { tarGz, validTemplateEntries } from './archive-fixture.js';

class PromptInput extends Readable {
	isTTY = true;
	rawMode = false;

	_read() {}

	setRawMode(value: boolean) {
		this.rawMode = value;
		return this;
	}
}

class PromptOutput extends Writable {
	isTTY = false;
	columns = 80;
	rows = 20;
	_write(_chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
		callback();
	}
}

function responseFromBuffer(buffer: Buffer): Response {
	const body = buffer.buffer.slice(
		buffer.byteOffset,
		buffer.byteOffset + buffer.byteLength
	) as ArrayBuffer;
	return new Response(body);
}

function realPromptAdapter(
	input: PromptInput,
	output: PromptOutput,
	hooks: { text?: () => void; confirm?: () => void } = {}
): PromptAdapter {
	return {
		text: (options) => {
			hooks.text?.();
			return clack.text({ ...options, input, output });
		},
		confirm: (options) => {
			hooks.confirm?.();
			return clack.confirm({ ...options, input, output });
		},
		isCancel: clack.isCancel,
		cancel: vi.fn()
	};
}

const temporaryDirectories: string[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
	);
});

describe('parseCliOptions', () => {
	it('parses the documented options', () => {
		expect(
			parseCliOptions([
				'app',
				'--slug',
				'app',
				'--repo',
				'owner/app',
				'--brand',
				'App',
				'--company',
				'Company',
				'--operator',
				'Operator',
				'--address',
				'Address',
				'--email',
				'local@example.test',
				'--ref',
				'release',
				'--yes',
				'--trust-template',
				'--skip-install'
			])
		).toMatchObject({
			directory: 'app',
			slug: 'app',
			repo: 'owner/app',
			brand: 'App',
			ref: 'release',
			yes: true,
			trustTemplate: true,
			skipInstall: true
		});
	});

	it('matches the template setup validation subset', () => {
		expect(() =>
			validateProvidedValues({
				slug: 'project',
				repo: 'owner/project',
				brand: 'Project',
				company: 'Company\nDivision',
				operator: 'Operator',
				address: 'Line 1\nLine 2',
				email: "d'éveloper+local@exämple.test",
				ref: 'release/v1'
			})
		).not.toThrow();
	});

	it.each([
		[['--unknown'], /Unknown option/],
		[['one', 'two'], /Only one target/],
		[['--repo', 'owner/one', '--repo', 'owner/two'], /only be provided once/],
		[['-h', '--help'], /only be provided once/],
		[['--slug', ''], /must not be empty/]
	])('rejects invalid argv %#', (argv, message) => {
		expect(() => parseCliOptions(argv)).toThrow(message);
	});
});

describe('option resolution and trust', () => {
	it('derives the slug and brand but never invents the repository owner', async () => {
		const parsed = parseCliOptions(['my-app', '--repo', 'owner/my-app', '--yes']);
		await expect(resolveOptions(parsed, { interactive: false })).resolves.toMatchObject({
			directory: 'my-app',
			slug: 'my-app',
			brand: 'my-app',
			repo: 'owner/my-app'
		});
		await expect(
			resolveOptions(parseCliOptions(['my-app', '--yes']), { interactive: false })
		).rejects.toThrow('--repo is required');
	});

	it('derives target names with the same platform path semantics as target inspection', () => {
		expect(deriveSlug(String.raw`parent\my-app`, 'win32')).toBe('my-app');
		expect(deriveSlug(String.raw`bad\name`, 'linux')).toBeUndefined();
		expect(deriveSlug('parent/my-app', 'linux')).toBe('my-app');
	});

	it('requires explicit trust without prompts even with --yes', async () => {
		await expect(confirmTemplateTrust('a'.repeat(40), false, false)).rejects.toThrow(
			'--trust-template'
		);
		await expect(confirmTemplateTrust('a'.repeat(40), false, true)).resolves.toBeUndefined();
	});

	it('uses the real Clack cancellation result at every prompt boundary', async () => {
		const input = new PromptInput();
		const output = new PromptOutput();
		const pending = clack.text({ message: 'Cancel', input, output });
		input.emit('keypress', '', { name: 'escape' });
		const cancellation = await pending;
		expect(clack.isCancel(cancellation)).toBe(true);
		const prompts: PromptAdapter = {
			text: async () => cancellation,
			confirm: clack.confirm,
			isCancel: clack.isCancel,
			cancel: vi.fn()
		};
		await expect(
			resolveOptions(parseCliOptions([]), { interactive: true, prompts })
		).rejects.toBeInstanceOf(PromptCancelledError);
		expect(prompts.cancel).toHaveBeenCalledOnce();
	});
});

describe('side-effect-free commands', () => {
	it('keeps the interrupt listener installed through repeated SIGINT events', () => {
		const emitter = new EventEmitter();
		const listener = vi.fn();
		const remove = listenForInterrupt(listener, emitter);

		emitter.emit('SIGINT');
		emitter.emit('SIGINT');
		expect(listener).toHaveBeenCalledTimes(2);
		expect(emitter.listenerCount('SIGINT')).toBe(1);
		remove();
		expect(emitter.listenerCount('SIGINT')).toBe(0);
	});

	it.each(['--help', '--version'])('runs %s without Bun or network access', async (option) => {
		const messages: string[] = [];
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockRejectedValue(new Error('fetch must not run'));
		const code = await runCli([option], {
			stdout: (message) => messages.push(message),
			stderr: (message) => messages.push(message),
			stdin: process.stdin,
			environment: {},
			cwd: process.cwd()
		});
		expect(code).toBe(0);
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(messages).not.toEqual([]);
	});
});

describe('interrupt handling', () => {
	it('cancels a waiting real text prompt without orphaned listeners', async () => {
		const parent = await mkdtemp(path.join(tmpdir(), 'create-saas-starter-text-sigint-'));
		temporaryDirectories.push(parent);
		const input = new PromptInput();
		const output = new PromptOutput();
		let announceStarted!: () => void;
		const started = new Promise<void>((resolve) => (announceStarted = resolve));
		const baselineListeners = process.listenerCount('SIGINT');
		const running = runCli([], {
			stdout: () => {},
			stderr: () => {},
			stdin: input as unknown as NodeJS.ReadStream,
			environment: process.env,
			cwd: parent,
			prompts: realPromptAdapter(input, output, { text: announceStarted })
		});
		await started;
		expect(input.listenerCount('keypress')).toBeGreaterThan(0);

		process.emit('SIGINT');
		process.emit('SIGINT');
		await expect(running).resolves.toBe(130);
		expect(input.listenerCount('keypress')).toBe(0);
		expect(output.listenerCount('resize')).toBe(0);
		expect(input.rawMode).toBe(false);
		expect(process.listenerCount('SIGINT')).toBe(baselineListeners);
		expect(await readdir(parent)).toEqual([]);
	});

	it('cancels a waiting real trust prompt without claiming the target', async () => {
		const parent = await mkdtemp(path.join(tmpdir(), 'create-saas-starter-confirm-sigint-'));
		temporaryDirectories.push(parent);
		const input = new PromptInput();
		const output = new PromptOutput();
		let announceStarted!: () => void;
		const started = new Promise<void>((resolve) => (announceStarted = resolve));
		const archive = tarGz(validTemplateEntries());
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(responseFromBuffer(archive));
		const baselineListeners = process.listenerCount('SIGINT');
		const running = runCli(
			[
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
				'contact@example.test'
			],
			{
				stdout: () => {},
				stderr: () => {},
				stdin: input as unknown as NodeJS.ReadStream,
				environment: process.env,
				cwd: parent,
				prompts: realPromptAdapter(input, output, { confirm: announceStarted })
			}
		);
		await started;
		expect(input.listenerCount('keypress')).toBeGreaterThan(0);

		process.emit('SIGINT');
		process.emit('SIGINT');
		await expect(running).resolves.toBe(130);
		expect(input.listenerCount('keypress')).toBe(0);
		expect(output.listenerCount('resize')).toBe(0);
		expect(input.rawMode).toBe(false);
		expect(process.listenerCount('SIGINT')).toBe(baselineListeners);
		expect(await readdir(parent)).toEqual([]);
	});

	it('returns 130 and leaves no target when repeated SIGINT arrives before claim', async () => {
		const parent = await mkdtemp(path.join(tmpdir(), 'create-saas-starter-pre-claim-sigint-'));
		temporaryDirectories.push(parent);
		const messages: string[] = [];
		const archive = tarGz(validTemplateEntries());
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
			process.emit('SIGINT');
			process.emit('SIGINT');
			return responseFromBuffer(archive);
		});

		const code = await runCli(['project', '--repo', 'owner/project', '--yes', '--trust-template'], {
			stdout: (message) => messages.push(message),
			stderr: (message) => messages.push(message),
			stdin: process.stdin,
			environment: process.env,
			cwd: parent
		});

		expect(code).toBe(130);
		expect(fetchSpy).toHaveBeenCalledOnce();
		expect(await readdir(parent)).toEqual([]);
		expect(messages.join('\n')).toContain('interrupted');
	});
});

describe('dry run', () => {
	it('does not prompt, fetch, spawn, or write', async () => {
		const parent = await mkdtemp(path.join(tmpdir(), 'create-saas-starter-dry-'));
		temporaryDirectories.push(parent);
		const messages: string[] = [];
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockRejectedValue(new Error('fetch must not run'));
		const code = await runCli(['project', '--repo', 'owner/project', '--yes', '--dry-run'], {
			stdout: (message) => messages.push(message),
			stderr: (message) => messages.push(message),
			stdin: process.stdin,
			environment: { PATH: '' },
			cwd: parent
		});

		expect(code).toBe(0);
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(await readdir(parent)).toEqual([]);
		expect(messages.join('\n')).toContain('Dry run complete');
	});

	it('does not let --yes grant trust or start a download', async () => {
		const parent = await mkdtemp(path.join(tmpdir(), 'create-saas-starter-trust-'));
		temporaryDirectories.push(parent);
		const messages: string[] = [];
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockRejectedValue(new Error('fetch must not run'));
		const code = await runCli(['project', '--repo', 'owner/project', '--yes'], {
			stdout: (message) => messages.push(message),
			stderr: (message) => messages.push(message),
			stdin: process.stdin,
			environment: { PATH: process.env.PATH },
			cwd: parent
		});

		expect(code).toBe(1);
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(await readdir(parent)).toEqual([]);
		expect(messages.join('\n')).toContain('--trust-template');
	});

	it('still rejects existing targets', async () => {
		const parent = await mkdtemp(path.join(tmpdir(), 'create-saas-starter-existing-'));
		temporaryDirectories.push(parent);
		const messages: string[] = [];
		await writeFile(path.join(parent, 'project'), 'preserve');
		const code = await runCli(['project', '--repo', 'owner/project', '--yes', '--dry-run'], {
			stdout: (message) => messages.push(message),
			stderr: (message) => messages.push(message),
			stdin: process.stdin,
			environment: {},
			cwd: parent
		});

		expect(code).toBe(1);
		expect(await readFile(path.join(parent, 'project'), 'utf8')).toBe('preserve');
	});
});
