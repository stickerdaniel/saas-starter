import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
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
import { openWindowsJobLifetime, windowsJobCommand, WINDOWS_JOB_TOKEN_ENV } from './windows-job';

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

function forceStopWindowsTree(pid: number | undefined): void {
	if (!pid || process.platform !== 'win32') return;
	spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
}

async function waitForChild(
	child: ReturnType<typeof spawn>,
	timeoutMs = 10_000
): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
	let stdout = '';
	let stderr = '';
	child.stdout?.on('data', (chunk) => (stdout += chunk));
	child.stderr?.on('data', (chunk) => (stderr += chunk));
	return await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			child.kill();
			reject(new Error(`Child process did not exit within ${timeoutMs} ms.`));
		}, timeoutMs);
		child.once('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.once('exit', (code, signal) => {
			clearTimeout(timeout);
			resolve({ code, signal, stdout, stderr });
		});
	});
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
		expect(windowsJobCommand(command, { platform: 'darwin' })).toBe(command);
	});

	it('requires a lifetime for Windows commands', () => {
		expect(() =>
			windowsJobCommand({ command: 'bun', args: ['run', 'dev'] }, { platform: 'win32' })
		).toThrow('Windows Job Object lifetime is required.');
	});

	it('assigns the Job Object during process creation', () => {
		const source = readFileSync(path.join(process.cwd(), 'scripts/windows-job-runner.ps1'), 'utf8');
		expect(source).toContain('PROC_THREAD_ATTRIBUTE_JOB_LIST');
		expect(source).toContain('EXTENDED_STARTUPINFO_PRESENT');
		expect(source).not.toContain('AssignProcessToJobObject');
	});

	it('encodes the executable and arguments as one PowerShell payload', () => {
		let encodedPayload = '';
		const lifetime = {
			pipeName: 'test-lifetime-pipe',
			token: 'test-lifetime-token',
			setPayload: (value: string) => (encodedPayload = value),
			close: async () => {}
		};
		const wrapped = windowsJobCommand(
			{
				command: String.raw`C:\Program Files\Bun\bun.exe`,
				args: ['run', 'space value', 'quote"value', '', '--once'],
				env: { EXAMPLE: 'value' }
			},
			{ platform: 'win32', lifetime }
		);
		expect(encodedPayload).not.toBe('');
		const payload = JSON.parse(Buffer.from(encodedPayload, 'base64').toString('utf8'));

		expect(wrapped.command).toBe('powershell.exe');
		expect(wrapped.args).toContain('-NonInteractive');
		expect(wrapped.args).toContain('-File');
		expect(wrapped.args.at(-2)).toMatch(/windows-job-runner\.ps1$/);
		expect(wrapped.args.at(-1)).toBe('test-lifetime-pipe');
		expect(payload.command).toBe(String.raw`C:\Program Files\Bun\bun.exe`);
		expect(payload.args).toEqual(['run', 'space value', 'quote"value', '', '--once']);
		expect(payload.environment.includes('EXAMPLE=value')).toBe(true);
		expect(
			payload.environment.some((entry: string) => entry.startsWith(`${WINDOWS_JOB_TOKEN_ENV}=`))
		).toBe(false);
		expect(wrapped.env?.EXAMPLE).toBe('value');
		expect(wrapped.env?.[WINDOWS_JOB_TOKEN_ENV]).toBe('test-lifetime-token');
	});

	it.runIf(process.platform === 'win32')(
		'does not expose the payload to an unauthenticated pipe client',
		async () => {
			const lifetime = await openWindowsJobLifetime({ platform: 'win32' });
			if (!lifetime) throw new Error('Windows lifetime pipe did not start.');
			lifetime.setPayload(Buffer.from('secret payload').toString('base64'));
			let received = '';
			try {
				await new Promise<void>((resolve, reject) => {
					const socket = createConnection('\\\\.\\pipe\\' + lifetime.pipeName);
					const timeout = setTimeout(() => {
						socket.destroy();
						reject(new Error('Unauthenticated pipe client was not rejected.'));
					}, 5_000);
					socket.setEncoding('utf8');
					socket.on('data', (chunk) => (received += chunk));
					socket.once('connect', () => socket.write('wrong-token\n'));
					socket.once('error', (error) => {
						clearTimeout(timeout);
						reject(error);
					});
					socket.once('close', () => {
						clearTimeout(timeout);
						resolve();
					});
				});
				expect(received).toBe('');
			} finally {
				await lifetime.close();
			}
		},
		10_000
	);

	it.runIf(process.platform === 'win32')(
		'propagates the managed root exit code',
		async () => {
			const lifetime = await openWindowsJobLifetime({ platform: 'win32' });
			if (!lifetime) throw new Error('Windows lifetime pipe did not start.');
			try {
				const wrapped = windowsJobCommand(
					{ command: process.execPath, args: ['-e', 'process.exit(7)'] },
					{ platform: 'win32', lifetime }
				);
				const child = spawn(wrapped.command, wrapped.args, {
					stdio: ['ignore', 'pipe', 'pipe'],
					env: { ...process.env, ...wrapped.env }
				});
				const result = await waitForChild(child);
				expect(result.stderr).toBe('');
				expect(result.code).toBe(7);
			} finally {
				await lifetime.close();
			}
		},
		20_000
	);

	it.runIf(process.platform === 'win32')(
		'does not start a command after the orchestrator lifetime is gone',
		async () => {
			const directory = mkdtempSync(path.join(tmpdir(), 'windows-job-lifetime-gone-'));
			const markerFile = path.join(directory, 'started');
			const lifetime = await openWindowsJobLifetime({ platform: 'win32' });
			if (!lifetime) throw new Error('Windows lifetime pipe did not start.');
			const wrapped = windowsJobCommand(
				{
					command: process.execPath,
					args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(markerFile)}, '')`]
				},
				{ platform: 'win32', lifetime }
			);
			await lifetime.close();
			try {
				const child = spawn(wrapped.command, wrapped.args, {
					cwd: directory,
					stdio: ['ignore', 'pipe', 'pipe'],
					env: { ...process.env, ...wrapped.env }
				});
				const result = await waitForChild(child);
				expect(result.signal).toBeNull();
				expect(result.code).not.toBe(0);
				expect(existsSync(markerFile)).toBe(false);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		},
		20_000
	);

	it.runIf(process.platform === 'win32')(
		'preserves spaces, quotes, backslashes, flags, and empty arguments',
		async () => {
			const directory = mkdtempSync(path.join(tmpdir(), 'windows-job-argv-'));
			const script = path.join(directory, 'capture.cjs');
			const output = path.join(directory, 'argv.json');
			const lifetime = await openWindowsJobLifetime({ platform: 'win32' });
			if (!lifetime) throw new Error('Windows lifetime pipe did not start.');
			writeFileSync(
				script,
				"require('node:fs').writeFileSync(process.env.ARGV_OUTPUT, JSON.stringify({args:process.argv.slice(2),psModulePath:process.env.PSModulePath,token:process.env.SAAS_STARTER_WINDOWS_JOB_TOKEN??null}))"
			);
			try {
				const wrapped = windowsJobCommand(
					{
						command: process.execPath,
						args: [script, 'space value', 'quote"value', 'backslash\\', '', '--once'],
						env: { ARGV_OUTPUT: output, PSModulePath: 'exact-module-path' }
					},
					{ platform: 'win32', lifetime }
				);
				const child = spawn(wrapped.command, wrapped.args, {
					cwd: directory,
					env: { ...process.env, ...wrapped.env },
					stdio: ['ignore', 'pipe', 'pipe']
				});
				const result = await waitForChild(child);
				expect(result.stderr).toBe('');
				expect(result.code).toBe(0);
				expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual({
					args: ['space value', 'quote"value', 'backslash\\', '', '--once'],
					psModulePath: 'exact-module-path',
					token: null
				});
			} finally {
				await lifetime.close();
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
			{
				stdio: process.platform === 'win32' ? 'inherit' : 'ignore',
				graceMs: 100,
				forceMs: 100
			}
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
			let grandchildPid: number | undefined;
			try {
				const code = await runUntilOneExits(
					[
						{ command: process.execPath, args: ['-e', root] },
						{ command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] }
					],
					{
						stdio: 'inherit',
						graceMs: 500,
						forceMs: 1_000
					}
				);
				grandchildPid = Number(readFileSync(pidFile, 'utf8'));
				expect(code).toBe(7);
				expect(await waitUntilStopped(grandchildPid)).toBe(true);
			} finally {
				forceStopWindowsTree(grandchildPid);
				rmSync(directory, { recursive: true, force: true });
			}
		},
		20_000
	);

	it.runIf(process.platform === 'win32')(
		'kills the job when the orchestrator lifetime closes',
		async () => {
			const directory = mkdtempSync(path.join(tmpdir(), 'windows-job-orchestrator-exit-'));
			const pidFile = path.join(directory, 'processes.json');
			const escapedPidFile = JSON.stringify(pidFile);
			const root = `const{spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${escapedPidFile},JSON.stringify({root:process.pid,grandchild:child.pid}));setInterval(()=>{},1000)`;
			const lifetime = await openWindowsJobLifetime({ platform: 'win32' });
			if (!lifetime) throw new Error('Windows lifetime pipe did not start.');
			const wrapped = windowsJobCommand(
				{ command: process.execPath, args: ['-e', root] },
				{ platform: 'win32', lifetime }
			);
			const owner = spawn(wrapped.command, wrapped.args, {
				cwd: directory,
				stdio: 'ignore',
				env: { ...process.env, ...wrapped.env }
			});
			let rootPid: number | undefined;
			let grandchildPid: number | undefined;
			try {
				for (let attempt = 0; attempt < 400 && !existsSync(pidFile); attempt++) {
					await new Promise((resolve) => setTimeout(resolve, 25));
				}
				expect(existsSync(pidFile)).toBe(true);
				const pids = JSON.parse(readFileSync(pidFile, 'utf8'));
				rootPid = pids.root;
				grandchildPid = pids.grandchild;
				expect(processExists(rootPid!)).toBe(true);
				expect(processExists(grandchildPid!)).toBe(true);
				await lifetime.close();
				expect(await waitUntilStopped(rootPid!)).toBe(true);
				expect(await waitUntilStopped(grandchildPid!)).toBe(true);
			} finally {
				await lifetime.close();
				forceStopWindowsTree(owner.pid);
				forceStopWindowsTree(rootPid);
				forceStopWindowsTree(grandchildPid);
				rmSync(directory, { recursive: true, force: true });
			}
		},
		20_000
	);

	it.runIf(process.platform === 'win32')(
		'kills the job when its PowerShell owner is terminated',
		async () => {
			const directory = mkdtempSync(path.join(tmpdir(), 'windows-job-owner-exit-'));
			const pidFile = path.join(directory, 'processes.json');
			const escapedPidFile = JSON.stringify(pidFile);
			const root = `const{spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${escapedPidFile},JSON.stringify({root:process.pid,grandchild:child.pid}));setInterval(()=>{},1000)`;
			const lifetime = await openWindowsJobLifetime({ platform: 'win32' });
			if (!lifetime) throw new Error('Windows lifetime pipe did not start.');
			const wrapped = windowsJobCommand(
				{ command: process.execPath, args: ['-e', root] },
				{ platform: 'win32', lifetime }
			);
			const owner = spawn(wrapped.command, wrapped.args, {
				cwd: directory,
				stdio: 'ignore',
				env: { ...process.env, ...wrapped.env }
			});
			let rootPid: number | undefined;
			let grandchildPid: number | undefined;
			try {
				for (let attempt = 0; attempt < 400 && !existsSync(pidFile); attempt++) {
					await new Promise((resolve) => setTimeout(resolve, 25));
				}
				expect(existsSync(pidFile)).toBe(true);
				const pids = JSON.parse(readFileSync(pidFile, 'utf8'));
				rootPid = pids.root;
				grandchildPid = pids.grandchild;
				expect(processExists(rootPid!)).toBe(true);
				expect(processExists(grandchildPid!)).toBe(true);
				spawnSync('taskkill', ['/PID', String(owner.pid), '/F'], { stdio: 'ignore' });
				expect(await waitUntilStopped(rootPid!)).toBe(true);
				expect(await waitUntilStopped(grandchildPid!)).toBe(true);
			} finally {
				await lifetime.close();
				forceStopWindowsTree(owner.pid);
				forceStopWindowsTree(rootPid);
				forceStopWindowsTree(grandchildPid);
				rmSync(directory, { recursive: true, force: true });
			}
		},
		20_000
	);
});
