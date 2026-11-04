/**
 * Drives `startCommand` the way a full CI lint run does: commands start first and report at
 * a later point. Usage: `bun started-command.ts <case> <directory>`.
 */
import { EventEmitter } from 'node:events';
import { existsSync, writeSync } from 'node:fs';
import path from 'node:path';
import type { Writable } from 'node:stream';
import { runCommand, startCommand } from '../../static-checks';
import { readPid } from './pid-file';

const [scenario, directory = ''] = process.argv.slice(2);
const bun = process.execPath;

async function waitFor(file: string, ready = () => existsSync(file)): Promise<void> {
	const deadline = Date.now() + 10_000;
	while (!ready()) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${file}`);
		await Bun.sleep(10);
	}
}

const waitForPid = (file: string) => waitFor(file, () => readPid(file) !== undefined);

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
		// A destination that refuses, once, the first chunk containing REFUSE (`SOURCE-1` or the
		// opening workflow-command marker), then accepts again. What it accepted is printed
		// when the process exits.
		const needle = process.env.REFUSE ?? 'SOURCE-1';
		const accepted: string[] = [];
		let refused = false;
		const destination = Object.assign(new EventEmitter(), {
			write(text: string, callback: (error?: Error) => void) {
				if (!refused && text.includes(needle)) {
					refused = true;
					callback(new Error('destination refused a write'));
				} else {
					accepted.push(text);
					callback();
				}
				return true;
			}
		}) as unknown as Writable;
		process.on('exit', () => writeSync(1, `accepted:${JSON.stringify(accepted.join(''))}\n`));
		const done = path.join(directory, 'done');
		// SOURCE-2 follows SOURCE-1 on the same stream; OTHER-SOURCE is on the other one.
		const args = [
			'-e',
			`const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
			process.stdout.write('SOURCE-1\\n'); pause();
			process.stdout.write('SOURCE-2\\n'); pause();
			process.stderr.write('OTHER-SOURCE\\n');
			require('fs').writeFileSync(process.argv[1], '');
			process.exit(3);`,
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
		await waitForPid(stubborn);
		await waitForPid(orphaned);
		// The failure exit an earlier check takes while later commands still run.
		process.exit(1);
	}
}
