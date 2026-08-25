import {
	spawn,
	spawnSync,
	type ChildProcess,
	type SpawnOptions,
	type StdioOptions
} from 'node:child_process';
import { constants as osConstants } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWindowsJobLifetime, windowsJobCommand, type ChildCommand } from './windows-job';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_GRACE_MS = 2_000;
const DEFAULT_FORCE_MS = 2_000;

export interface ProcessGroupOptions {
	stdio?: StdioOptions;
	graceMs?: number;
	forceMs?: number;
}

interface ChildExit {
	index: number;
	code: number | null;
	signal: NodeJS.Signals | null;
}

export function listenForTermination(onSignal: (signal: NodeJS.Signals) => void): () => void {
	const onInterrupt = () => onSignal('SIGINT');
	const onTerminate = () => onSignal('SIGTERM');
	process.on('SIGINT', onInterrupt);
	process.on('SIGTERM', onTerminate);
	return () => {
		process.off('SIGINT', onInterrupt);
		process.off('SIGTERM', onTerminate);
	};
}

export function exitCodeFor(code: number | null, signal: NodeJS.Signals | null): number {
	if (code !== null) return code;
	const signalNumber = signal ? osConstants.signals[signal] : undefined;
	return signalNumber === undefined ? 1 : 128 + signalNumber;
}

function waitForExit(child: ChildProcess, index: number): Promise<ChildExit> {
	return new Promise((resolve, reject) => {
		child.once('error', reject);
		child.once('exit', (code, signal) => resolve({ index, code, signal }));
	});
}

function waitForAll(exits: Array<Promise<ChildExit>>, timeoutMs: number): Promise<boolean> {
	return new Promise((resolve) => {
		const timeout = setTimeout(() => resolve(false), timeoutMs);
		void Promise.allSettled(exits).then(() => {
			clearTimeout(timeout);
			resolve(true);
		});
	});
}

export function windowsTreeKillArgs(pid: number, force: boolean): string[] {
	return ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])];
}

function terminateTree(child: ChildProcess, force: boolean): void {
	if (!child.pid) return;
	if (process.platform === 'win32') {
		spawnSync('taskkill', windowsTreeKillArgs(child.pid, force), {
			stdio: 'ignore',
			windowsHide: true
		});
		return;
	}
	try {
		process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
	}
}

function processTreeExists(child: ChildProcess): boolean {
	if (!child.pid) return false;
	if (process.platform === 'win32') {
		return child.exitCode === null && child.signalCode === null;
	}
	try {
		process.kill(-child.pid, 0);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
		throw error;
	}
}

export function devCloudCommands(args: string[] = process.argv.slice(2)): ChildCommand[] {
	return [
		{
			command: process.execPath,
			args: [path.join(PROJECT_ROOT, 'scripts/dev.ts')],
			env: { npm_lifecycle_event: 'dev:frontend' }
		},
		{
			command: process.execPath,
			args: [path.join(PROJECT_ROOT, 'scripts/dev-convex-cloud.ts'), ...args],
			env: { AUTHORED_CONTENT_WATCH: '0' }
		}
	];
}

export async function runUntilOneExits(
	commands: ChildCommand[],
	options: ProcessGroupOptions = {}
): Promise<number> {
	if (commands.length < 2) throw new Error('At least two child commands are required.');
	const lifetimes = [];
	try {
		for (const _command of commands) lifetimes.push(await openWindowsJobLifetime());
		const spawnOptions: SpawnOptions = {
			stdio: options.stdio ?? 'inherit',
			detached: process.platform !== 'win32'
		};
		const children = commands
			.map((command, index) => {
				const lifetime = lifetimes[index];
				return windowsJobCommand(command, lifetime ? { lifetimePipe: lifetime.pipeName } : {});
			})
			.map(({ command, args, env }) =>
				spawn(command, args, { ...spawnOptions, env: { ...process.env, ...env } })
			);
		const exits = children.map(waitForExit);
		let resolveSignal!: (exit: ChildExit) => void;
		const signalExit = new Promise<ChildExit>((resolve) => {
			resolveSignal = resolve;
		});
		const removeTerminationListeners = listenForTermination((signal) =>
			resolveSignal({ index: -1, code: null, signal })
		);

		try {
			const first = await Promise.race([...exits, signalExit]);
			for (const child of children) terminateTree(child, false);
			const directChildrenExited = await waitForAll(exits, options.graceMs ?? DEFAULT_GRACE_MS);
			if (!directChildrenExited || children.some(processTreeExists)) {
				for (const child of children) terminateTree(child, true);
				await waitForAll(exits, options.forceMs ?? DEFAULT_FORCE_MS);
			}
			return exitCodeFor(first.code, first.signal);
		} catch (error) {
			for (const child of children) terminateTree(child, true);
			await waitForAll(exits, options.forceMs ?? DEFAULT_FORCE_MS);
			throw error;
		} finally {
			removeTerminationListeners();
		}
	} finally {
		await Promise.all(lifetimes.map((lifetime) => lifetime?.close()));
	}
}

if (import.meta.main) {
	process.exit(await runUntilOneExits(devCloudCommands()));
}
