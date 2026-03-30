import { spawnSync } from 'child_process';

export const colors = {
	reset: '\x1b[0m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	red: '\x1b[31m'
};

export function runCommand(
	command: string,
	args: string[],
	env?: Record<string, string | undefined>
): boolean {
	const result = spawnSync(command, args, {
		stdio: 'inherit',
		encoding: 'utf-8',
		env: env ?? process.env
	});
	return result.status === 0;
}

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

export async function runCommandWithRetry(
	command: string,
	args: string[],
	options: {
		maxRetries?: number;
		delayMs?: number;
		description?: string;
		env?: Record<string, string | undefined>;
	} = {}
): Promise<{ success: boolean; stdout: string; stderr: string }> {
	const { maxRetries = 5, delayMs = 5000, description = 'command', env } = options;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		const result = runCommandCapture(command, args, env);

		if (result.success) {
			return result;
		}

		console.log(
			`${colors.yellow}[Attempt ${attempt}/${maxRetries}] ${description} failed${colors.reset}`
		);
		if (result.stdout) console.log(`  stdout: ${result.stdout}`);
		if (result.stderr) console.log(`  stderr: ${result.stderr}`);

		if (attempt < maxRetries) {
			console.log(`  Retrying in ${delayMs / 1000}s...`);
			await sleep(delayMs);
		}
	}

	return runCommandCapture(command, args, env);
}
