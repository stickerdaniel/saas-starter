import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli, type CliIo, type CliRuntime } from '../src/index.js';
import { SCAFFOLD_MARKER } from '../src/archive.js';
import { updateMarker } from '../src/target.js';
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

async function fixtureIo(): Promise<{ parent: string; messages: string[]; io: CliIo }> {
	const parent = await mkdtemp(path.join(tmpdir(), 'create-saas-starter-late-abort-'));
	temporaryDirectories.push(parent);
	const messages: string[] = [];
	return {
		parent,
		messages,
		io: {
			stdout: (message) => messages.push(message),
			stderr: (message) => messages.push(message),
			stdin: process.stdin,
			environment: process.env,
			cwd: parent
		}
	};
}

async function markerAt(parent: string): Promise<{ state: string; phase: string }> {
	return JSON.parse(await readFile(path.join(parent, 'project', SCAFFOLD_MARKER), 'utf8')) as {
		state: string;
		phase: string;
	};
}

describe('CLI lifecycle', () => {
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
		const claimTarget = vi.fn(async () => {});

		await expect(runCli(argumentsForProject(), io, { claimTarget })).resolves.toBe(1);
		expect(claimTarget).not.toHaveBeenCalled();
		await expect(lstat(path.join(parent, 'project'))).rejects.toMatchObject({ code: 'ENOENT' });
		expect(messages.join('\n')).toMatch(/Target path is not portable.*archive file/);
	});

	it('turns an abort after setup completion into preserved incomplete state', async () => {
		const { parent, messages, io } = await fixtureIo();
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			responseFromBuffer(tarGz(validTemplateEntries()))
		);
		const runtime: Partial<CliRuntime> = {
			updateMarker,
			runSetupAndInstall: async (input) => {
				await input.onSetupComplete();
				process.emit('SIGINT');
				process.emit('SIGINT');
				return 'needs-install';
			}
		};

		await expect(runCli(argumentsForProject(['--skip-install']), io, runtime)).resolves.toBe(130);
		await expect(markerAt(parent)).resolves.toMatchObject({
			state: 'incomplete',
			phase: 'install'
		});
		expect(messages.some((message) => message.startsWith('Created '))).toBe(false);
		expect(messages.join('\n')).toContain('interrupted');
	});

	it('replaces a final ready marker with incomplete state when marker I/O is followed by abort', async () => {
		const { parent, messages, io } = await fixtureIo();
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			responseFromBuffer(tarGz(validTemplateEntries()))
		);
		let interrupted = false;
		const runtime: Partial<CliRuntime> = {
			runSetupAndInstall: async (input) => {
				await input.onSetupComplete();
				return 'ready';
			},
			updateMarker: async (...input) => {
				if (!interrupted && input[2] === 'ready' && input[3] === 'complete') {
					interrupted = true;
					process.emit('SIGINT');
					process.emit('SIGINT');
				}
				return await updateMarker(...input);
			}
		};

		await expect(runCli(argumentsForProject(), io, runtime)).resolves.toBe(130);
		await expect(markerAt(parent)).resolves.toMatchObject({
			state: 'incomplete',
			phase: 'complete'
		});
		expect(messages.some((message) => message.startsWith('Created '))).toBe(false);
		expect(messages.join('\n')).toContain('interrupted');
	});
});
