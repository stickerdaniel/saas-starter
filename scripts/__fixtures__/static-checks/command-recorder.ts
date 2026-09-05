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

const command = path.basename(process.execPath).replace(/\.exe$/i, '');
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
