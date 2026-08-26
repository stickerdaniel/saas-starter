import { spawnSync } from 'child_process';

export const colors = {
	reset: '\x1b[0m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	red: '\x1b[31m'
};

export function runCommandCapture(
	command: string,
	args: string[],
	env?: Record<string, string | undefined>
): { success: boolean; stdout: string; stderr: string } {
	const result = spawnSync(command, args, {
		encoding: 'utf-8',
		env: env ?? process.env
	});
	return {
		success: result.status === 0,
		stdout: result.stdout?.trim() ?? '',
		stderr: result.stderr?.trim() ?? ''
	};
}

export function stripAnsi(str: string): string {
	// eslint-disable-next-line no-control-regex -- ANSI codes intentionally use control characters
	return str.replace(/\x1b\[[0-9;]*m/g, '');
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
