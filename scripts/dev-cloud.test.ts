import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	devCloudCommands,
	exitCodeFor,
	listenForTermination,
	runUntilOneExits,
	windowsTreeKillArgs
} from './dev-cloud';
import { windowsJobCommand } from './windows-job';

function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitUntilStopped(pid: number): Promise<boolean> {
	for (let attempt = 0; attempt < 200; attempt++) {
		if (!processExists(pid)) return true;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return !processExists(pid);
}

describe('devCloudCommands', () => {
	it('forwards Convex arguments only to the backend child', () => {
		const [frontend, backend] = devCloudCommands(['--once', '--typecheck', 'disable']);
		expect(frontend?.args).not.toContain('--once');
		expect(backend?.args.slice(-3)).toEqual(['--once', '--typecheck', 'disable']);
	});

	it('constructs a recursive Windows tree termination command', () => {
		expect(windowsTreeKillArgs(42, false)).toEqual(['/PID', '42', '/T']);
		expect(windowsTreeKillArgs(42, true)).toEqual(['/PID', '42', '/T', '/F']);
	});

	it('preserves conventional signal exit codes', () => {
		expect(exitCodeFor(null, 'SIGINT')).toBe(130);
		expect(exitCodeFor(null, 'SIGTERM')).toBe(143);
		expect(exitCodeFor(7, null)).toBe(7);
	});
});

describe('windowsJobCommand', () => {
	it('leaves non-Windows commands unchanged', () => {
		const command = { command: 'bun', args: ['run', 'dev'] };
		expect(windowsJobCommand(command, 'darwin')).toBe(command);
	});

	it('encodes the executable and arguments as one PowerShell payload', () => {
		const wrapped = windowsJobCommand(
			{
				command: String.raw`C:\Program Files\Bun\bun.exe`,
				args: ['run', 'space value', 'quote"value', '', '--once'],
				env: { EXAMPLE: 'value' }
			},
			'win32'
		);
		const payload = JSON.parse(Buffer.from(wrapped.args.at(-1)!, 'base64').toString('utf8'));

		expect(wrapped.command).toBe('powershell.exe');
		expect(wrapped.args).toContain('-NonInteractive');
		expect(wrapped.args).toContain('-File');
		expect(wrapped.args.at(-2)).toMatch(/windows-job-runner\.ps1$/);
		expect(payload).toEqual({
			command: String.raw`C:\Program Files\Bun\bun.exe`,
			args: ['run', 'space value', 'quote"value', '', '--once']
		});
		expect(wrapped.env).toEqual({ EXAMPLE: 'value' });
	});

	it.runIf(process.platform === 'win32')(
		'preserves spaces, quotes, backslashes, flags, and empty arguments',
		() => {
			const directory = mkdtempSync(path.join(tmpdir(), 'windows-job-argv-'));
			const script = path.join(directory, 'capture.cjs');
			const output = path.join(directory, 'argv.json');
			writeFileSync(
				script,
				"require('node:fs').writeFileSync(process.env.ARGV_OUTPUT, JSON.stringify(process.argv.slice(2)))"
			);
			try {
				const wrapped = windowsJobCommand(
					{
						command: process.execPath,
						args: [script, 'space value', 'quote"value', 'backslash\\', '', '--once'],
						env: { ARGV_OUTPUT: output }
					},
					'win32'
				);
				const result = spawnSync(wrapped.command, wrapped.args, {
					cwd: directory,
					env: { ...process.env, ...wrapped.env },
					encoding: 'utf8'
				});
				expect(result.stderr).toBe('');
				expect(result.status).toBe(0);
				expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual([
					'space value',
					'quote"value',
					'backslash\\',
					'',
					'--once'
				]);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		},
		20_000
	);
});

describe('listenForTermination', () => {
	it('keeps intercepting repeated signals until cleanup finishes', () => {
		const signals: NodeJS.Signals[] = [];
		const removeListeners = listenForTermination((signal) => signals.push(signal));
		try {
			process.emit('SIGINT');
			process.emit('SIGINT');
			expect(signals).toEqual(['SIGINT', 'SIGINT']);
		} finally {
			removeListeners();
		}
	});
});

describe('runUntilOneExits', () => {
	it('returns the first exit code and terminates the sibling process', async () => {
		const code = await runUntilOneExits(
			[
				{ command: process.execPath, args: ['-e', 'setTimeout(() => process.exit(7), 25)'] },
				{ command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] }
			],
			{ stdio: 'ignore', graceMs: 100, forceMs: 100 }
		);
		expect(code).toBe(7);
	});

	it.skipIf(process.platform === 'win32')(
		'force-stops a signal-resistant child and its grandchild',
		async () => {
			const directory = mkdtempSync(path.join(tmpdir(), 'dev-cloud-process-'));
			const pidFile = path.join(directory, 'grandchild.pid');
			const escapedPidFile = JSON.stringify(pidFile);
			const leader = `const fs=require('node:fs');const timer=setInterval(()=>{if(fs.existsSync(${escapedPidFile})){clearInterval(timer);process.exit(7)}},10)`;
			const worker = `const{spawn}=require('node:child_process');const fs=require('node:fs');process.on('SIGTERM',()=>{});const child=spawn(process.execPath,['-e','process.on(\\'SIGTERM\\',()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${escapedPidFile},String(child.pid));setInterval(()=>{},1000)`;
			try {
				const code = await runUntilOneExits(
					[
						{ command: process.execPath, args: ['-e', leader] },
						{ command: process.execPath, args: ['-e', worker] }
					],
					{ stdio: 'ignore', graceMs: 100, forceMs: 500 }
				);
				expect(code).toBe(7);
				expect(existsSync(pidFile)).toBe(true);
				const grandchildPid = Number(readFileSync(pidFile, 'utf8'));
				expect(await waitUntilStopped(grandchildPid)).toBe(true);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		},
		10_000
	);

	it.skipIf(process.platform === 'win32')(
		'force-stops a grandchild after its wrapper exits on SIGTERM',
		async () => {
			const directory = mkdtempSync(path.join(tmpdir(), 'dev-cloud-wrapper-exit-'));
			const pidFile = path.join(directory, 'grandchild.pid');
			const escapedPidFile = JSON.stringify(pidFile);
			const leader = `const fs=require('node:fs');const timer=setInterval(()=>{if(fs.existsSync(${escapedPidFile})){clearInterval(timer);process.exit(7)}},10)`;
			const worker = `const{spawn}=require('node:child_process');const fs=require('node:fs');process.on('SIGTERM',()=>process.exit(0));const child=spawn(process.execPath,['-e','process.on(\\'SIGTERM\\',()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${escapedPidFile},String(child.pid));setInterval(()=>{},1000)`;
			try {
				const code = await runUntilOneExits(
					[
						{ command: process.execPath, args: ['-e', leader] },
						{ command: process.execPath, args: ['-e', worker] }
					],
					{ stdio: 'ignore', graceMs: 100, forceMs: 500 }
				);
				expect(code).toBe(7);
				const grandchildPid = Number(readFileSync(pidFile, 'utf8'));
				expect(await waitUntilStopped(grandchildPid)).toBe(true);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		},
		10_000
	);

	it.runIf(process.platform === 'win32')(
		'kills descendants when the managed root exits first',
		async () => {
			const directory = mkdtempSync(path.join(tmpdir(), 'windows-job-root-exit-'));
			const pidFile = path.join(directory, 'grandchild.pid');
			const escapedPidFile = JSON.stringify(pidFile);
			const root = `const{spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${escapedPidFile},String(child.pid));process.exit(7)`;
			try {
				const code = await runUntilOneExits(
					[
						{ command: process.execPath, args: ['-e', root] },
						{ command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] }
					],
					{ stdio: 'ignore', graceMs: 500, forceMs: 1_000 }
				);
				expect(code).toBe(7);
				const grandchildPid = Number(readFileSync(pidFile, 'utf8'));
				expect(await waitUntilStopped(grandchildPid)).toBe(true);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		},
		20_000
	);

	it.runIf(process.platform === 'win32')(
		'kills the job when its PowerShell owner is terminated',
		async () => {
			const directory = mkdtempSync(path.join(tmpdir(), 'windows-job-owner-exit-'));
			const pidFile = path.join(directory, 'grandchild.pid');
			const escapedPidFile = JSON.stringify(pidFile);
			const root = `const{spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${escapedPidFile},String(child.pid));setInterval(()=>{},1000)`;
			const wrapped = windowsJobCommand({ command: process.execPath, args: ['-e', root] }, 'win32');
			const owner = spawn(wrapped.command, wrapped.args, {
				cwd: directory,
				stdio: 'ignore',
				env: { ...process.env, ...wrapped.env }
			});
			try {
				for (let attempt = 0; attempt < 400 && !existsSync(pidFile); attempt++) {
					await new Promise((resolve) => setTimeout(resolve, 25));
				}
				expect(existsSync(pidFile)).toBe(true);
				const grandchildPid = Number(readFileSync(pidFile, 'utf8'));
				spawnSync('taskkill', ['/PID', String(owner.pid), '/F'], { stdio: 'ignore' });
				expect(await waitUntilStopped(grandchildPid)).toBe(true);
			} finally {
				if (owner.exitCode === null) owner.kill();
				rmSync(directory, { recursive: true, force: true });
			}
		},
		20_000
	);
});
