import { describe, expect, it, vi } from 'vitest';
import {
	runCommand,
	runCommandWithRetry,
	type CommandExit,
	type CommandRunnerDependencies,
	type CommandTimer,
	type SpawnCommand,
	type SpawnedCommand
} from './command-runner';

function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason?: unknown) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

async function* outputStream(
	...chunks: Array<string | Uint8Array>
): AsyncIterable<string | Uint8Array> {
	for (const chunk of chunks) yield chunk;
}

function spawnedCommand(
	exit: CommandExit | Promise<CommandExit>,
	options: {
		stdout?: AsyncIterable<string | Uint8Array> | null;
		stderr?: AsyncIterable<string | Uint8Array> | null;
		pid?: number;
	} = {}
): SpawnedCommand {
	return {
		pid: options.pid ?? 1234,
		stdout: options.stdout ?? null,
		stderr: options.stderr ?? null,
		exited: Promise.resolve(exit),
		kill: vi.fn(() => true)
	};
}

function exitWithCode(exitCode: number): SpawnedCommand {
	return spawnedCommand({ exitCode, signal: null });
}

function queuedSpawn(...children: SpawnedCommand[]): SpawnCommand {
	let index = 0;
	return vi.fn(() => {
		const child = children[index];
		if (!child) throw new Error(`Unexpected spawn ${index + 1}`);
		index += 1;
		return child;
	});
}

interface ControlledTimer extends CommandTimer {
	callback: () => void;
	ms: number;
	cancel: () => void;
}

function timerQueue(): {
	timers: ControlledTimer[];
	createTimer: CommandRunnerDependencies['createTimer'];
} {
	const timers: ControlledTimer[] = [];
	return {
		timers,
		createTimer: (callback, ms) => {
			const timer: ControlledTimer = { callback, ms, cancel: vi.fn<() => void>() };
			timers.push(timer);
			return timer;
		}
	};
}

describe('runCommand', () => {
	it('captures output and applies cwd plus an environment overlay', async () => {
		const encoder = new TextEncoder();
		const spawn = vi.fn(() =>
			spawnedCommand(
				{ exitCode: 0, signal: null },
				{
					stdout: outputStream('hello ', encoder.encode('world')),
					stderr: outputStream('warning')
				}
			)
		);

		const result = await runCommand(
			{
				command: 'tool',
				args: ['one', 'two words'],
				cwd: '/workspace',
				env: { ADDED: 'new', REMOVED: undefined }
			},
			{
				spawn,
				baseEnv: { KEPT: 'base', REMOVED: 'old' }
			}
		);

		expect(result).toMatchObject({
			ok: true,
			exitCode: 0,
			stdout: 'hello world',
			stderr: 'warning'
		});
		expect(spawn).toHaveBeenCalledWith({
			command: 'tool',
			args: ['one', 'two words'],
			cwd: '/workspace',
			env: { KEPT: 'base', ADDED: 'new' },
			output: 'capture'
		});
	});

	it('supports inherited output without manufacturing captures', async () => {
		const spawn = vi.fn(() => exitWithCode(0));

		const result = await runCommand({ command: 'tool', output: 'inherit' }, { spawn, baseEnv: {} });

		expect(result).toMatchObject({ ok: true, stdout: '', stderr: '' });
		expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ output: 'inherit' }));
	});

	it('classifies a missing executable without starting a retry protocol', async () => {
		const missing = Object.assign(new Error('spawn missing-tool ENOENT'), { code: 'ENOENT' });
		const spawn = vi.fn(() => {
			throw missing;
		});

		const result = await runCommand({ command: 'missing-tool' }, { spawn, baseEnv: {} });

		expect(result).toMatchObject({ ok: false, kind: 'not_found' });
	});

	it('redacts explicit and inherited secret values from printable diagnostics', async () => {
		const argumentSecret = 'argument-secret';
		const inheritedSecret = 'inherited-secret';
		const spawn = vi.fn(() =>
			spawnedCommand(
				{ exitCode: 2, signal: null },
				{
					stderr: outputStream(`failed ${argumentSecret} ${inheritedSecret}`)
				}
			)
		);

		const result = await runCommand(
			{
				command: 'tool',
				args: ['--credential', argumentSecret],
				redact: [argumentSecret]
			},
			{
				spawn,
				baseEnv: { SERVICE_TOKEN: inheritedSecret }
			}
		);

		expect(result.ok).toBe(false);
		expect(result.description).not.toContain(argumentSecret);
		expect(result.diagnostic).not.toContain(argumentSecret);
		expect(result.diagnostic).not.toContain(inheritedSecret);
		expect(result.diagnostic).toContain('[REDACTED]');
		// Captures remain raw for callers that must parse tool output.
		expect(result.stderr).toContain(argumentSecret);
	});

	it('redacts secrets that require escaping in a quoted argument', async () => {
		const secret = 'quote"and\\slash';
		const spawn = vi.fn(() => exitWithCode(1));

		const result = await runCommand(
			{ command: 'tool', args: ['--token', secret], redact: [secret] },
			{ spawn, baseEnv: {} }
		);

		expect(result.description).not.toContain(secret);
		expect(result.description).not.toContain(JSON.stringify(secret).slice(1, -1));
		expect(result.description).toContain('[REDACTED]');
	});

	it('sanitizes a spawn cause before exposing it', async () => {
		const secret = 'spawn-secret';
		const spawn = vi.fn(() => {
			const error = new Error(`failed with ${secret}`);
			error.name = `Spawn ${secret}`;
			throw error;
		});

		const result = await runCommand({ command: 'tool', redact: [secret] }, { spawn, baseEnv: {} });

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('Expected command failure');
		expect(result.cause?.message).toBe('failed with [REDACTED]');
		expect(result.cause?.name).toBe('Spawn [REDACTED]');
	});

	it('returns before spawning when the parent signal is already aborted', async () => {
		const controller = new AbortController();
		controller.abort();
		const spawn = vi.fn(() => exitWithCode(0));

		const result = await runCommand(
			{ command: 'tool', signal: controller.signal },
			{ spawn, baseEnv: {} }
		);

		expect(result).toMatchObject({ ok: false, kind: 'aborted' });
		expect(spawn).not.toHaveBeenCalled();
	});

	it('terminates and settles the child when the parent aborts', async () => {
		const controller = new AbortController();
		const exit = deferred<CommandExit>();
		const child = spawnedCommand(exit.promise);
		const spawn = vi.fn(() => child);
		const killProcessTree = vi.fn((_child: SpawnedCommand, signal: NodeJS.Signals) => {
			if (signal === 'SIGTERM') exit.resolve({ exitCode: null, signal });
		});

		const resultPromise = runCommand(
			{ command: 'tool', signal: controller.signal },
			{ spawn, killProcessTree, baseEnv: {} }
		);
		controller.abort();
		const result = await resultPromise;

		expect(result).toMatchObject({ ok: false, kind: 'aborted', signal: 'SIGTERM' });
		expect(killProcessTree.mock.calls).toEqual([
			[child, 'SIGTERM'],
			[child, 'SIGKILL']
		]);
	});

	it('escalates after the grace period and classifies a timeout', async () => {
		const exit = deferred<CommandExit>();
		const child = spawnedCommand(exit.promise);
		const spawn = vi.fn(() => child);
		const { timers, createTimer } = timerQueue();
		const terminationSignals: NodeJS.Signals[] = [];
		const killProcessTree = vi.fn((_child: SpawnedCommand, signal: NodeJS.Signals) => {
			terminationSignals.push(signal);
			if (signal === 'SIGKILL') exit.resolve({ exitCode: null, signal });
		});

		const resultPromise = runCommand(
			{ command: 'tool', timeoutMs: 25, terminationGraceMs: 10 },
			{ spawn, createTimer, killProcessTree, baseEnv: {} }
		);
		expect(timers).toHaveLength(1);
		expect(timers[0]?.ms).toBe(25);
		timers[0]?.callback();
		expect(timers).toHaveLength(2);
		expect(timers[1]?.ms).toBe(10);
		timers[1]?.callback();

		const result = await resultPromise;
		expect(result).toMatchObject({ ok: false, kind: 'timed_out', signal: 'SIGKILL' });
		expect(terminationSignals).toEqual(['SIGTERM', 'SIGKILL']);
	});
});

describe('runCommandWithRetry', () => {
	it('returns after a first-attempt success', async () => {
		const spawn = queuedSpawn(exitWithCode(0));
		const sleep = vi.fn(async () => undefined);

		const outcome = await runCommandWithRetry(
			{ command: 'tool' },
			{ maxAttempts: 3 },
			{ spawn, sleep, baseEnv: {} }
		);

		expect(outcome).toMatchObject({ attempts: 1, result: { ok: true } });
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(sleep).not.toHaveBeenCalled();
	});

	it('succeeds on a later attempt and delays only between executions', async () => {
		const spawn = queuedSpawn(exitWithCode(1), exitWithCode(0));
		const sleep = vi.fn(async () => undefined);

		const outcome = await runCommandWithRetry(
			{ command: 'tool' },
			{ maxAttempts: 4, delay: { kind: 'fixed', delayMs: 50 } },
			{ spawn, sleep, baseEnv: {} }
		);

		expect(outcome).toMatchObject({ attempts: 2, result: { ok: true } });
		expect(spawn).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenCalledTimes(1);
		expect(sleep).toHaveBeenCalledWith(50, undefined);
	});

	it('executes exactly once when maxAttempts is one', async () => {
		const spawn = queuedSpawn(exitWithCode(1));
		const sleep = vi.fn(async () => undefined);

		const outcome = await runCommandWithRetry(
			{ command: 'tool' },
			{ maxAttempts: 1 },
			{ spawn, sleep, baseEnv: {} }
		);

		expect(outcome).toMatchObject({ attempts: 1, result: { ok: false } });
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(sleep).not.toHaveBeenCalled();
	});

	it('executes exactly N attempts with no hidden final call', async () => {
		const spawn = queuedSpawn(exitWithCode(1), exitWithCode(1), exitWithCode(1));
		const sleep = vi.fn(async () => undefined);

		const outcome = await runCommandWithRetry(
			{ command: 'tool' },
			{ maxAttempts: 3, delay: { kind: 'fixed', delayMs: 20 } },
			{ spawn, sleep, baseEnv: {} }
		);

		expect(outcome).toMatchObject({ attempts: 3, result: { ok: false } });
		expect(spawn).toHaveBeenCalledTimes(3);
		expect(sleep).toHaveBeenCalledTimes(2);
	});

	it('stops immediately on a caller-classified non-retryable failure', async () => {
		const spawn = queuedSpawn(exitWithCode(2));
		const sleep = vi.fn(async () => undefined);
		const shouldRetry = vi.fn(() => false);

		const outcome = await runCommandWithRetry(
			{ command: 'tool' },
			{ maxAttempts: 5, shouldRetry },
			{ spawn, sleep, baseEnv: {} }
		);

		expect(outcome.attempts).toBe(1);
		expect(shouldRetry).toHaveBeenCalledWith(expect.objectContaining({ kind: 'non_zero_exit' }), 1);
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(sleep).not.toHaveBeenCalled();
	});

	it('applies a bounded exponential delay policy exactly N minus one times', async () => {
		const spawn = queuedSpawn(exitWithCode(1), exitWithCode(1), exitWithCode(1));
		const delays: number[] = [];
		const sleep = vi.fn(async (ms: number, _signal?: AbortSignal) => {
			delays.push(ms);
		});

		await runCommandWithRetry(
			{ command: 'tool' },
			{
				maxAttempts: 3,
				delay: { kind: 'exponential', initialDelayMs: 10, multiplier: 3, maxDelayMs: 25 }
			},
			{ spawn, sleep, baseEnv: {} }
		);

		expect(delays).toEqual([10, 25]);
	});

	it('reports each failed attempt with the next retry decision', async () => {
		const spawn = queuedSpawn(exitWithCode(1), exitWithCode(1));
		const onFailedAttempt = vi.fn();

		await runCommandWithRetry(
			{ command: 'tool' },
			{
				maxAttempts: 2,
				delay: { kind: 'fixed', delayMs: 30 },
				onFailedAttempt
			},
			{ spawn, sleep: async () => undefined, baseEnv: {} }
		);

		expect(onFailedAttempt).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ attempt: 1, willRetry: true, nextDelayMs: 30 })
		);
		expect(onFailedAttempt).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ attempt: 2, willRetry: false, nextDelayMs: null })
		);
	});

	it('stops retries when the parent aborts a running child', async () => {
		const controller = new AbortController();
		const exit = deferred<CommandExit>();
		const child = spawnedCommand(exit.promise);
		const spawn = vi.fn(() => child);
		const sleep = vi.fn(async () => undefined);
		const killProcessTree = vi.fn((_child: SpawnedCommand, signal: NodeJS.Signals) => {
			exit.resolve({ exitCode: null, signal });
		});

		const outcomePromise = runCommandWithRetry(
			{ command: 'tool', signal: controller.signal },
			{ maxAttempts: 4, shouldRetry: () => true },
			{ spawn, sleep, killProcessTree, baseEnv: {} }
		);
		controller.abort();
		const outcome = await outcomePromise;

		expect(outcome).toMatchObject({ attempts: 1, result: { ok: false, kind: 'aborted' } });
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(sleep).not.toHaveBeenCalled();
	});

	it('stops future executions when the parent aborts during the delay', async () => {
		const controller = new AbortController();
		const spawn = queuedSpawn(exitWithCode(1));
		const enteredSleep = deferred<void>();
		const sleep = vi.fn(
			async (_ms: number, signal?: AbortSignal): Promise<void> =>
				await new Promise((_resolve, reject) => {
					enteredSleep.resolve();
					const onAbort = () => {
						const error = new Error('aborted');
						error.name = 'AbortError';
						reject(error);
					};
					signal?.addEventListener('abort', onAbort, { once: true });
					if (signal?.aborted) onAbort();
				})
		);

		const outcomePromise = runCommandWithRetry(
			{ command: 'tool', signal: controller.signal },
			{ maxAttempts: 3, delay: { kind: 'fixed', delayMs: 10 } },
			{ spawn, sleep, baseEnv: {} }
		);
		await enteredSleep.promise;
		controller.abort();
		const outcome = await outcomePromise;

		expect(outcome).toMatchObject({ attempts: 1, result: { ok: false, kind: 'aborted' } });
		expect(spawn).toHaveBeenCalledTimes(1);
	});

	it('does not retry a timed-out attempt even when the caller asks to retry it', async () => {
		const exit = deferred<CommandExit>();
		const child = spawnedCommand(exit.promise);
		const spawn = vi.fn(() => child);
		const sleep = vi.fn(async () => undefined);
		const { timers, createTimer } = timerQueue();
		const killProcessTree = vi.fn((_child: SpawnedCommand, signal: NodeJS.Signals) => {
			exit.resolve({ exitCode: null, signal });
		});

		const outcomePromise = runCommandWithRetry(
			{ command: 'tool', timeoutMs: 5 },
			{ maxAttempts: 3, shouldRetry: () => true },
			{ spawn, sleep, createTimer, killProcessTree, baseEnv: {} }
		);
		expect(timers).toHaveLength(1);
		timers[0]?.callback();
		const outcome = await outcomePromise;

		expect(outcome).toMatchObject({ attempts: 1, result: { ok: false, kind: 'timed_out' } });
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(sleep).not.toHaveBeenCalled();
	});
});
