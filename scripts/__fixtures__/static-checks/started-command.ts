/**
 * Drives `startCommand` the way a full CI lint run does: commands start first and report at
 * a later point. Usage: `bun started-command.ts <case> <directory>`.
 */
import { EventEmitter } from 'node:events';
import { existsSync, writeSync } from 'node:fs';
import path from 'node:path';
import type { Writable } from 'node:stream';
import { runCommand, startCommand } from '../../static-checks';

const [scenario, directory = ''] = process.argv.slice(2);
const bun = process.execPath;

async function waitFor(file: string): Promise<void> {
	const deadline = Date.now() + 10_000;
	while (!existsSync(file)) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${file}`);
		await Bun.sleep(10);
	}
}

// A chunk on one pipe and a chunk on the other have no shared clock; the pauses make the
// child's write order the order in which its output reaches this process.
const INTERLEAVED = `
	const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
	process.stdout.write('out-1\\n'); pause();
	process.stderr.write('err-1\\n'); pause();
	process.stdout.write('out-2\\n');
	require('fs').writeFileSync(process.argv[1], '');
`;

// Prints a prefix, then finishes only once the test has seen that prefix.
const GATED = `
	const { existsSync } = require('fs');
	process.stdout.write('prefix\\n');
	const deadline = Date.now() + 5000;
	const timer = setInterval(() => {
		if (existsSync(process.argv[1])) {
			clearInterval(timer);
			process.stdout.write('suffix\\n');
		} else if (Date.now() > deadline) process.exit(9);
	}, 10);
`;

// A leader that stays alive beside a grandchild ignoring SIGTERM, and a leader that exits
// at once and leaves its grandchild in the group. Each grandchild writes its pid to a file.
const STUBBORN_TREE = `
	const { spawn } = require('child_process');
	spawn('sh', ['-c', 'trap "" TERM; echo $$ > "$0"; exec sleep 30', process.argv[1]], { stdio: 'ignore' });
	setTimeout(() => {}, 30000);
`;
const ORPHANED_TREE = `
	const { spawn } = require('child_process');
	spawn('sh', ['-c', 'echo $$ > "$0"; exec sleep 30', process.argv[1]], { stdio: 'ignore' }).unref();
`;

switch (scenario) {
	case 'interleaved': {
		const done = path.join(directory, 'done');
		const command = startCommand(bun, ['-e', INTERLEAVED, done]);
		await waitFor(done);
		console.log('before-finish');
		await command.finish();
		console.log('after-finish');
		break;
	}
	case 'gated': {
		const command = startCommand(bun, ['-e', GATED, path.join(directory, 'gate')]);
		console.log('finishing');
		await command.finish();
		console.log('finished');
		break;
	}
	case 'started-failure':
	case 'run-failure': {
		const args = ['-e', "console.log('diagnostic'); process.exit(3)"];
		const command = scenario === 'started-failure' ? startCommand(bun, args) : undefined;
		console.log('before-finish');
		await (command?.finish() ?? runCommand(bun, args));
		break;
	}
	case 'started-missing':
	case 'run-missing': {
		const missing = 'missing-static-checks-command';
		const command = scenario === 'started-missing' ? startCommand(missing, []) : undefined;
		console.log('before-finish');
		await (command?.finish() ?? runCommand(missing, []));
		break;
	}
	case 'destination-error-started':
	case 'destination-error-run': {
		// A destination that refuses the first chunk carrying SOURCE once, then accepts again.
		// What it received is printed when the process exits.
		const received: string[] = [];
		let refused = false;
		const destination = Object.assign(new EventEmitter(), {
			write(text: string, callback: (error?: Error) => void) {
				received.push(text);
				if (!refused && text.includes('SOURCE')) {
					refused = true;
					callback(new Error('destination refused a write'));
				} else callback();
				return true;
			}
		}) as unknown as Writable;
		process.on('exit', () => writeSync(1, `received:${JSON.stringify(received.join(''))}\n`));
		const done = path.join(directory, 'done');
		const args = [
			'-e',
			`process.stdout.write('SOURCE\\n');
			setTimeout(() => {
				process.stderr.write('LATER-DIAGNOSTIC\\n');
				require('fs').writeFileSync(process.argv[1], '');
				process.exit(3);
			}, 200);`,
			done
		];
		const options = { stdout: destination, stderr: destination };
		if (scenario === 'destination-error-run') await runCommand(bun, args, options);
		const command = startCommand(bun, args, options);
		await waitFor(done);
		await command.finish();
		break;
	}
	default:
		throw new Error(`Unknown case ${scenario}`);
	case 'early-exit': {
		const stubborn = path.join(directory, 'stubborn');
		const orphaned = path.join(directory, 'orphaned');
		startCommand(bun, ['-e', STUBBORN_TREE, stubborn]);
		await startCommand(bun, ['-e', ORPHANED_TREE, orphaned]).finish();
		await waitFor(stubborn);
		await waitFor(orphaned);
		// The failure exit an earlier check takes while later commands still run.
		process.exit(1);
	}
}
