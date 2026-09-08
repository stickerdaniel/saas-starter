import { appendFileSync } from 'node:fs';
import path from 'node:path';

interface CommandResponse {
	command: string;
	args: string[];
	status: number;
	stdout?: string;
	stderr?: string;
}

const logPath = process.env.STATIC_CHECKS_COMMAND_LOG;
if (!logPath) throw new Error('Static-check command log is not configured.');

// The recorder is delivered in two forms: on Windows as a compiled file whose invocation name
// is stored in process.execPath, and on POSIX as a shebang script started by the real Bun whose
// invocation name therefore appears only in process.argv[1]. In both forms, the arguments
// start at index 2.
const invokedAs =
	process.platform === 'win32' ? process.execPath : (process.argv[1] ?? process.execPath);
const command = path.basename(invokedAs).replace(/\.exe$/i, '');
const args = process.argv.slice(2);
appendFileSync(logPath, `${JSON.stringify({ command, args })}\n`);

const configured = process.env.STATIC_CHECKS_COMMAND_RESPONSE;
const response = configured ? (JSON.parse(configured) as CommandResponse) : undefined;
const matched =
	response?.command === command &&
	response.args.length === args.length &&
	response.args.every((arg, index) => arg === args[index]);

if (matched) {
	if (response.stdout) process.stdout.write(response.stdout);
	if (response.stderr) process.stderr.write(response.stderr);
	process.exitCode = response.status;
}
