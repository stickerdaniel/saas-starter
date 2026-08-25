import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { devCloudCommands, runUntilOneExits, windowsTreeKillArgs } from './dev-cloud';

function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitUntilStopped(pid: number): Promise<boolean> {
	for (let attempt = 0; attempt < 50; attempt++) {
		if (!processExists(pid)) return true;
		await new Promise((resolve) => setTimeout(resolve, 20));
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
});
