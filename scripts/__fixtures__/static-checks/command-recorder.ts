import { appendFileSync } from 'node:fs';
import path from 'node:path';

interface CommandResponse {
	command: string;
	args: string[];
	status: number;
	stdout?: string;
	stderr?: string;
	delayMs?: number;
}

const logPath = process.env.STATIC_CHECKS_COMMAND_LOG;
if (!logPath) throw new Error('Static-check command log is not configured.');

// The recorder is delivered in two forms: on Windows as a compiled file whose invocation name
// is stored in process.execPath, and on POSIX through a shell wrapper that passes its name in the
// environment before starting this source with the real Bun. In both forms, arguments start at
// index 2; process.argv[1] remains a fallback for direct POSIX execution.
const invokedAs =
	process.env.STATIC_CHECKS_COMMAND_NAME ??
	(process.platform === 'win32' ? process.execPath : (process.argv[1] ?? process.execPath));
const command = path.basename(invokedAs).replace(/\.exe$/i, '');
const args = process.argv.slice(2);

const configured = process.env.STATIC_CHECKS_COMMAND_RESPONSE;
const parsed = configured
	? (JSON.parse(configured) as CommandResponse | CommandResponse[])
	: undefined;
const responses = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
const response = responses.find(
	(candidate) =>
		candidate.command === command &&
		candidate.args.length === args.length &&
		candidate.args.every((arg, index) => arg === args[index])
);

if (response?.delayMs) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, response.delayMs);
}
if (response) {
	if (response.stdout) process.stdout.write(response.stdout);
	if (response.stderr) process.stderr.write(response.stderr);
	process.exitCode = response.status;
}
appendFileSync(logPath, `${JSON.stringify({ command, args })}\n`);
