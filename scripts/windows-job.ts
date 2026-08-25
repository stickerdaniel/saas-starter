import { randomUUID } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ChildCommand {
	command: string;
	args: string[];
	env?: NodeJS.ProcessEnv;
}

export interface WindowsJobCommandOptions {
	platform?: NodeJS.Platform;
	lifetimePipe?: string;
}

export interface WindowsJobLifetimeOptions {
	platform?: NodeJS.Platform;
}

export interface WindowsJobLifetime {
	pipeName: string;
	close: () => Promise<void>;
}

const RUNNER = path.join(
	path.resolve(path.dirname(fileURLToPath(import.meta.url))),
	'windows-job-runner.ps1'
);

export async function openWindowsJobLifetime(
	options: WindowsJobLifetimeOptions = {}
): Promise<WindowsJobLifetime | null> {
	if ((options.platform ?? process.platform) !== 'win32') return null;

	const pipeName = `saas-starter-dev-cloud-${process.pid}-${randomUUID()}`;
	const pipePath = '\\\\.\\pipe\\' + pipeName;
	const sockets = new Set<Socket>();
	let closed = false;
	const server = createServer((socket) => {
		if (closed) {
			socket.destroy();
			return;
		}
		sockets.add(socket);
		socket.on('error', () => {});
		socket.on('close', () => sockets.delete(socket));
	});

	await new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => reject(error);
		server.once('error', onError);
		server.listen(pipePath, () => {
			server.off('error', onError);
			resolve();
		});
	});

	return {
		pipeName,
		close: async () => {
			if (closed) return;
			closed = true;
			for (const socket of sockets) socket.destroy();
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
		}
	};
}

export function windowsJobCommand(
	command: ChildCommand,
	options: WindowsJobCommandOptions = {}
): ChildCommand {
	if ((options.platform ?? process.platform) !== 'win32') return command;
	if (!options.lifetimePipe) throw new Error('Windows Job Object lifetime pipe is required.');
	const payload = Buffer.from(
		JSON.stringify({
			command: command.command,
			args: command.args,
			lifetimePipe: options.lifetimePipe
		}),
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
