import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process';

export interface ChildCommand {
	command: string;
	args: string[];
}

interface ChildExit {
	index: number;
	code: number | null;
	signal: NodeJS.Signals | null;
}

function waitForExit(child: ChildProcess, index: number): Promise<ChildExit> {
	return new Promise((resolve, reject) => {
		child.once('error', reject);
		child.once('exit', (code, signal) => resolve({ index, code, signal }));
	});
}

export async function runUntilOneExits(
	commands: ChildCommand[],
	stdio: StdioOptions = 'inherit'
): Promise<number> {
	if (commands.length < 2) throw new Error('At least two child commands are required.');
	const children = commands.map(({ command, args }) =>
		spawn(command, args, { stdio, env: { ...process.env } })
	);
	const exits = children.map(waitForExit);
	const stop = (signal: NodeJS.Signals = 'SIGTERM', except?: number) => {
		for (const [index, child] of children.entries()) {
			if (index !== except && child.exitCode === null && child.signalCode === null) {
				child.kill(signal);
			}
		}
	};
	const onInterrupt = () => stop('SIGINT');
	const onTerminate = () => stop('SIGTERM');
	process.once('SIGINT', onInterrupt);
	process.once('SIGTERM', onTerminate);

	try {
		const first = await Promise.race(exits);
		stop('SIGTERM', first.index);
		await Promise.allSettled(exits);
		return first.code ?? (first.signal ? 1 : 0);
	} catch (error) {
		stop();
		await Promise.allSettled(exits);
		throw error;
	} finally {
		process.off('SIGINT', onInterrupt);
		process.off('SIGTERM', onTerminate);
	}
}

if (import.meta.main) {
	const code = await runUntilOneExits([
		{ command: process.execPath, args: ['run', 'dev:frontend'] },
		{ command: process.execPath, args: ['run', '_dev:backend:cloud'] }
	]);
	process.exit(code);
}
