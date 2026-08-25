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
	lifetime?: WindowsJobLifetime;
}

export interface WindowsJobLifetimeOptions {
	platform?: NodeJS.Platform;
}

export interface WindowsJobLifetime {
	pipeName: string;
	setPayload: (payload: string) => void;
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
	let payload: string | null = null;
	const server = createServer((socket) => {
		if (closed || payload === null) {
			socket.destroy();
			return;
		}
		sockets.add(socket);
		socket.on('error', () => {});
		socket.on('close', () => sockets.delete(socket));
		socket.write(`${payload}\n`);
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
		setPayload: (value) => {
			if (payload !== null) throw new Error('Windows Job Object payload is already set.');
			payload = value;
		},
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

function environmentEntries(overrides: NodeJS.ProcessEnv | undefined): string[] {
	const entries = new Map<string, { name: string; value: string }>();
	for (const environment of [process.env, overrides]) {
		for (const [name, value] of Object.entries(environment ?? {})) {
			const key = name.toUpperCase();
			if (value === undefined) entries.delete(key);
			else entries.set(key, { name, value });
		}
	}
	return [...entries.values()].map(({ name, value }) => `${name}=${value}`);
}

export function windowsJobCommand(
	command: ChildCommand,
	options: WindowsJobCommandOptions = {}
): ChildCommand {
	if ((options.platform ?? process.platform) !== 'win32') return command;
	if (!options.lifetime) throw new Error('Windows Job Object lifetime is required.');
	const payload = Buffer.from(
		JSON.stringify({
			command: command.command,
			args: command.args,
			environment: environmentEntries(command.env)
		}),
		'utf8'
	).toString('base64');
	options.lifetime.setPayload(payload);
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
			options.lifetime.pipeName
		],
		env: command.env
	};
}
