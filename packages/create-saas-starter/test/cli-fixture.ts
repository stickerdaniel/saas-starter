import { EventEmitter } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli, type CliIo, type CliRuntime } from '../src/index.js';
import { SCAFFOLD_MARKER } from '../src/archive.js';
import { cliChildWork } from './child-work.js';

export const temporaryDirectories: string[] = [];

export function responseFromBuffer(buffer: Buffer): Response {
	const body = buffer.buffer.slice(
		buffer.byteOffset,
		buffer.byteOffset + buffer.byteLength
	) as ArrayBuffer;
	return new Response(body);
}

export function argumentsForProject(extra: string[] = []): string[] {
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
export async function fixtureIo(signal: AbortSignal): Promise<{
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

export async function markerAt(target: string): Promise<{ state: string; phase: string }> {
	return JSON.parse(await readFile(path.join(target, SCAFFOLD_MARKER), 'utf8')) as {
		state: string;
		phase: string;
	};
}
