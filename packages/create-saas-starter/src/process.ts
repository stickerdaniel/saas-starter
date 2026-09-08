import { spawn, type ChildProcess } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import {
	openWindowsJobLifetime,
	windowsJobCommand,
	type ChildCommand
} from '../../../scripts/windows-job.ts';
import type { ResolvedOptions } from './prompts.js';

const MINIMUM_BUN_VERSION = [1, 3, 9] as const;
const TERMINATION_GRACE_MS = 2_000;
const ENVIRONMENT_ALLOWLIST = new Set([
	'PATH',
	'HOME',
	'USERPROFILE',
	'HOMEDRIVE',
	'HOMEPATH',
	'TEMP',
	'TMP',
	'TMPDIR',
	'LANG',
	'LC_ALL',
	'LC_CTYPE',
	'SYSTEMROOT',
	'WINDIR',
	'COMSPEC',
	'PATHEXT',
	'TERM',
	'COLORTERM',
	'FORCE_COLOR',
	'NO_COLOR'
]);

export interface ProcessResult {
	code: number;
	stdout: string;
	stderr: string;
}

export interface RunProcessOptions {
	cwd?: string;
	env: NodeJS.ProcessEnv;
	signal: AbortSignal;
	capture?: boolean;
	platform?: NodeJS.Platform;
}

function executableNames(platform: NodeJS.Platform): string[] {
	return platform === 'win32' ? ['bun.exe'] : ['bun'];
}

export async function resolveBunExecutable(
	environment: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
	currentBun: string | null = process.versions.bun ? process.execPath : null
): Promise<string> {
	if (currentBun) return currentBun;
	const searchPath = environment.PATH ?? environment.Path ?? environment.path;
	if (!searchPath) throw new Error('Bun was not found because PATH is unavailable.');
	for (const directory of searchPath.split(path.delimiter)) {
		if (!directory) continue;
		for (const name of executableNames(platform)) {
			const candidate = path.join(directory, name);
			try {
				await access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK);
				return candidate;
			} catch {
				// Best effort while probing or terminating a process.
			}
		}
	}
	throw new Error('Bun 1.3.9 or newer is required for setup and installation.');
}

export function filteredEnvironment(
	environment: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
	const result: NodeJS.ProcessEnv = {};
	for (const [name, value] of Object.entries(environment)) {
		if (value !== undefined && ENVIRONMENT_ALLOWLIST.has(name.toUpperCase())) result[name] = value;
	}
	result.HUSKY = '0';
	return result;
}

function processGroupExists(pid: number): boolean {
	try {
		process.kill(-pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function terminatePosixGroup(pid: number): Promise<void> {
	if (!processGroupExists(pid)) return;
	try {
		process.kill(-pid, 'SIGTERM');
	} catch {
		// Best effort while probing or terminating a process.
	}
	await new Promise((resolve) => setTimeout(resolve, TERMINATION_GRACE_MS));
	if (!processGroupExists(pid)) return;
	try {
		process.kill(-pid, 'SIGKILL');
	} catch {
		// Best effort while probing or terminating a process.
	}
}

function collect(stream: NodeJS.ReadableStream | null): { value: () => string } {
	let output = '';
	stream?.on('data', (chunk) => (output += String(chunk)));
	return { value: () => output };
}

async function waitForChild(
	child: ChildProcess
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
	return await new Promise((resolve, reject) => {
		child.once('error', reject);
		child.once('exit', (code, signal) => resolve({ code, signal }));
	});
}

export async function runProcess(
	command: ChildCommand,
	options: RunProcessOptions
): Promise<ProcessResult> {
	const platform = options.platform ?? process.platform;
	const lifetime = await openWindowsJobLifetime({ platform });
	const wrapped = windowsJobCommand(
		{ ...command, env: options.env },
		{
			platform,
			...(lifetime ? { lifetime, inheritEnvironment: false } : {})
		}
	);
	let child: ChildProcess | undefined;
	let forceTimer: ReturnType<typeof setTimeout> | undefined;
	let aborted = options.signal.aborted;
	const onAbort = () => {
		aborted = true;
		if (!child?.pid) return;
		const pid = child.pid;
		if (platform === 'win32') child.kill();
		else {
			try {
				process.kill(-pid, 'SIGTERM');
			} catch {
				// Best effort while probing or terminating a process.
			}
		}
		forceTimer = setTimeout(() => {
			if (platform === 'win32') child?.kill('SIGKILL');
			else {
				try {
					process.kill(-pid, 'SIGKILL');
				} catch {
					// Absence is handled by the surrounding control flow.
				}
			}
		}, TERMINATION_GRACE_MS);
	};
	options.signal.addEventListener('abort', onAbort, { once: true });
	try {
		if (aborted) return { code: 130, stdout: '', stderr: '' };
		child = spawn(wrapped.command, wrapped.args, {
			cwd: options.cwd,
			env: wrapped.env,
			detached: platform !== 'win32',
			stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
			windowsHide: true
		});
		const stdout = collect(options.capture ? child.stdout : null);
		const stderr = collect(options.capture ? child.stderr : null);
		const result = await waitForChild(child);
		if (platform !== 'win32' && child.pid) await terminatePosixGroup(child.pid);
		if (aborted) return { code: 130, stdout: stdout.value(), stderr: stderr.value() };
		if (result.code !== null)
			return { code: result.code, stdout: stdout.value(), stderr: stderr.value() };
		const signalNumbers: Partial<Record<NodeJS.Signals, number>> = {
			SIGHUP: 1,
			SIGINT: 2,
			SIGQUIT: 3,
			SIGTERM: 15
		};
		const signalCode = result.signal ? 128 + (signalNumbers[result.signal] ?? 1) : 1;
		return { code: signalCode, stdout: stdout.value(), stderr: stderr.value() };
	} finally {
		if (forceTimer) clearTimeout(forceTimer);
		options.signal.removeEventListener('abort', onAbort);
		await lifetime?.close();
	}
}

export function assertSupportedBunVersion(value: string): void {
	const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
	if (!match) throw new Error('Bun returned an unrecognized version.');
	const version = match.slice(1).map(Number);
	for (let index = 0; index < MINIMUM_BUN_VERSION.length; index++) {
		if (version[index]! > MINIMUM_BUN_VERSION[index]!) return;
		if (version[index]! < MINIMUM_BUN_VERSION[index]!) {
			throw new Error('Bun 1.3.9 or newer is required for setup and installation.');
		}
	}
}

export async function verifyBun(
	signal: AbortSignal,
	environment: NodeJS.ProcessEnv = process.env
): Promise<{ executable: string; environment: NodeJS.ProcessEnv }> {
	const executable = await resolveBunExecutable(environment);
	const filtered = filteredEnvironment(environment);
	const result = await runProcess(
		{ command: executable, args: ['--version'], env: filtered },
		{ env: filtered, signal, capture: true }
	);
	if (result.code === 130) throw new Error('Scaffolding aborted.');
	if (result.code !== 0) throw new Error('Bun could not report its version.');
	assertSupportedBunVersion(result.stdout);
	return { executable, environment: filtered };
}

export function setupArguments(options: ResolvedOptions): string[] {
	const args = [
		'run',
		'setup',
		'--slug',
		options.slug,
		'--repo',
		options.repo,
		'--brand',
		options.brand
	];
	for (const [flag, value] of [
		['--company', options.company],
		['--operator', options.operator],
		['--address', options.address],
		['--email', options.email]
	] as const) {
		if (value !== undefined) args.push(flag, value);
	}
	return args;
}

export async function runSetupAndInstall(input: {
	bun: string;
	environment: NodeJS.ProcessEnv;
	target: string;
	options: ResolvedOptions;
	signal: AbortSignal;
	onSetupComplete: () => Promise<void>;
	run?: typeof runProcess;
}): Promise<'ready' | 'needs-install'> {
	const run = input.run ?? runProcess;
	const setup = await run(
		{ command: input.bun, args: setupArguments(input.options), env: input.environment },
		{ cwd: input.target, env: input.environment, signal: input.signal }
	);
	if (setup.code === 130) throw new Error('Scaffolding aborted.');
	if (setup.code !== 0) throw new Error(`Template setup failed with exit code ${setup.code}.`);
	await input.onSetupComplete();
	if (input.options.skipInstall) return 'needs-install';
	const install = await run(
		{
			command: input.bun,
			args: ['install', '--frozen-lockfile'],
			env: input.environment
		},
		{ cwd: input.target, env: input.environment, signal: input.signal }
	);
	if (install.code === 130) throw new Error('Scaffolding aborted.');
	if (install.code !== 0)
		throw new Error(`Dependency installation failed with exit code ${install.code}.`);
	return 'ready';
}
