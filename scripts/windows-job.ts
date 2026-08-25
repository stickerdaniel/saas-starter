import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ChildCommand {
	command: string;
	args: string[];
	env?: NodeJS.ProcessEnv;
}

const RUNNER = path.join(
	path.resolve(path.dirname(fileURLToPath(import.meta.url))),
	'windows-job-runner.ps1'
);

export function windowsJobCommand(
	command: ChildCommand,
	platform: NodeJS.Platform = process.platform
): ChildCommand {
	if (platform !== 'win32') return command;
	const payload = Buffer.from(
		JSON.stringify({ command: command.command, args: command.args }),
		'utf8'
	).toString('base64');
	return {
		command: 'powershell.exe',
		args: [
			'-NoLogo',
			'-NoProfile',
			'-NonInteractive',
			'-ExecutionPolicy',
			'Bypass',
			'-File',
			RUNNER,
			payload
		],
		env: command.env
	};
}
