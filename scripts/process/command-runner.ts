import { spawn as nodeSpawn, spawnSync } from 'node:child_process';

export type CommandOutputMode = 'capture' | 'inherit';

export interface CommandSpec {
	command: string;
	args?: readonly string[];
	cwd?: string;
	/** Overlay applied to the runner's base environment. `undefined` removes a key. */
	env?: Readonly<Record<string, string | undefined>>;
	output?: CommandOutputMode;
	timeoutMs?: number;
	signal?: AbortSignal;
	terminationGraceMs?: number;
	/** Exact values that must be removed from printable diagnostics. */
	redact?: readonly string[];
}

interface CommandResultBase {
	description: string;
	stdout: string;
	stderr: string;
	/** Redacted, printable summary. Raw captures remain available for program logic. */
	diagnostic: string;
}

export interface CommandSuccess extends CommandResultBase {
	ok: true;
	exitCode: 0;
}

export type CommandFailureKind =
	'not_found' | 'timed_out' | 'aborted' | 'non_zero_exit' | 'spawn_failed';

export interface CommandFailure extends CommandResultBase {
	ok: false;
	kind: CommandFailureKind;
	exitCode?: number;
	signal?: NodeJS.Signals;
	/** Sanitized spawn/stream cause. It never carries raw command arguments. */
	cause?: Error;
}

export type CommandResult = CommandSuccess | CommandFailure;

export interface CommandExit {
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	error?: NodeJS.ErrnoException;
}

export interface SpawnedCommand {
	pid?: number;
	stdout: AsyncIterable<Uint8Array | string> | null;
	stderr: AsyncIterable<Uint8Array | string> | null;
	exited: Promise<CommandExit>;
	kill(signal: NodeJS.Signals): boolean;
}

export interface SpawnRequest {
	command: string;
	args: readonly string[];
	cwd?: string;
	env: NodeJS.ProcessEnv;
	output: CommandOutputMode;
}

export type SpawnCommand = (request: SpawnRequest) => SpawnedCommand;
export type CommandSleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface CommandTimer {
	cancel(): void;
}

export interface CommandRunnerDependencies {
	spawn: SpawnCommand;
	sleep: CommandSleep;
	createTimer(callback: () => void, ms: number): CommandTimer;
	killProcessTree(child: SpawnedCommand, signal: NodeJS.Signals): void;
	baseEnv: NodeJS.ProcessEnv;
}

export type RetryDelayPolicy =
	| { kind: 'fixed'; delayMs: number }
	| {
			kind: 'exponential';
			initialDelayMs: number;
			multiplier?: number;
			maxDelayMs?: number;
	  };

export interface FailedCommandAttempt {
	result: CommandFailure;
	attempt: number;
	maxAttempts: number;
	willRetry: boolean;
	nextDelayMs: number | null;
}

export interface CommandRetryOptions {
	maxAttempts: number;
	delay?: RetryDelayPolicy;
	shouldRetry?: (result: CommandFailure, attempt: number) => boolean;
	onFailedAttempt?: (failure: FailedCommandAttempt) => void | Promise<void>;
}

export interface CommandRetryResult {
	result: CommandResult;
	/** Number of command executions, not the number of retries. */
	attempts: number;
}

const DEFAULT_TERMINATION_GRACE_MS = 1_000;
const SENSITIVE_ENV_KEY = /(?:TOKEN|SECRET|PASSWORD|PRIVATE|CREDENTIAL|API_KEY|DEPLOY_KEY|AUTH)/i;

function createAbortError(): Error {
	const error = new Error('The operation was aborted');
	error.name = 'AbortError';
	return error;
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(createAbortError());
			return;
		}

		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', onAbort);
			reject(createAbortError());
		};
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

function defaultCreateTimer(callback: () => void, ms: number): CommandTimer {
	const timer = setTimeout(callback, ms);
	return { cancel: () => clearTimeout(timer) };
}

function defaultSpawn(request: SpawnRequest): SpawnedCommand {
	const child = nodeSpawn(request.command, [...request.args], {
		cwd: request.cwd,
		env: request.env,
		shell: false,
		windowsHide: true,
		// A separate process group lets timeout/abort terminate descendants on POSIX.
		detached: process.platform !== 'win32',
		stdio:
			request.output === 'inherit' ? ['inherit', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe']
	});

	let spawnError: NodeJS.ErrnoException | undefined;
	const exited = new Promise<CommandExit>((resolve) => {
		child.once('error', (error) => {
			spawnError = error as NodeJS.ErrnoException;
		});
		child.once('close', (exitCode, signal) => {
			resolve({
				exitCode,
				signal: signal as NodeJS.Signals | null,
				error: spawnError
			});
		});
	});

	return {
		pid: child.pid,
		stdout: child.stdout as AsyncIterable<Uint8Array | string> | null,
		stderr: child.stderr as AsyncIterable<Uint8Array | string> | null,
		exited,
		kill: (signal) => child.kill(signal)
	};
}

function defaultKillProcessTree(child: SpawnedCommand, signal: NodeJS.Signals): void {
	if (child.pid !== undefined && process.platform === 'win32') {
		const args = ['/PID', String(child.pid), '/T'];
		if (signal === 'SIGKILL') args.push('/F');
		const result = spawnSync('taskkill', args, {
			stdio: 'ignore',
			windowsHide: true
		});
		if (result.status === 0) return;
	}

	if (child.pid !== undefined && process.platform !== 'win32') {
		try {
			process.kill(-child.pid, signal);
			return;
		} catch {
			// The child may have exited between the check and the group signal.
		}
	}

	try {
		child.kill(signal);
	} catch {
		// Already settled or no longer signalable.
	}
}

const DEFAULT_DEPENDENCIES: CommandRunnerDependencies = {
	spawn: defaultSpawn,
	sleep: defaultSleep,
	createTimer: defaultCreateTimer,
	killProcessTree: defaultKillProcessTree,
	baseEnv: process.env
};

function dependenciesWith(
	overrides: Partial<CommandRunnerDependencies>
): CommandRunnerDependencies {
	return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

function assertNonNegative(name: string, value: number | undefined): void {
	if (value === undefined) return;
	if (!Number.isFinite(value) || value < 0) {
		throw new RangeError(`${name} must be a finite non-negative number`);
	}
}

function validateSpec(spec: CommandSpec): void {
	if (spec.command.trim() === '') throw new TypeError('command must not be empty');
	assertNonNegative('timeoutMs', spec.timeoutMs);
	assertNonNegative('terminationGraceMs', spec.terminationGraceMs);
}

function mergeEnvironment(
	baseEnv: NodeJS.ProcessEnv,
	overlay: Readonly<Record<string, string | undefined>> | undefined
): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = { ...baseEnv };
	if (!overlay) return environment;

	for (const [key, value] of Object.entries(overlay)) {
		if (value === undefined) delete environment[key];
		else environment[key] = value;
	}
	return environment;
}

function formatToken(token: string): string {
	return token === '' || /\s|["'\\]/.test(token) ? JSON.stringify(token) : token;
}

export function redactCommandText(text: string, values: readonly string[]): string {
	const variants = new Set<string>();
	for (const value of values) {
		if (!value) continue;
		variants.add(value);
		// Printable command descriptions quote arguments as JSON. Redact the escaped
		// representation as well so quotes and backslashes cannot bypass masking.
		variants.add(JSON.stringify(value).slice(1, -1));
	}

	let redacted = text;
	for (const value of [...variants].sort((a, b) => b.length - a.length)) {
		redacted = redacted.split(value).join('[REDACTED]');
	}
	return redacted;
}

function collectRedactions(spec: CommandSpec, baseEnv: NodeJS.ProcessEnv): string[] {
	const values = [...(spec.redact ?? [])];
	for (const [key, value] of Object.entries(mergeEnvironment(baseEnv, spec.env))) {
		if (value && SENSITIVE_ENV_KEY.test(key)) values.push(value);
	}
	return values;
}

function commandDescription(spec: CommandSpec, redactions: readonly string[]): string {
	return [spec.command, ...(spec.args ?? [])]
		.map((token) => formatToken(redactCommandText(token, redactions)))
		.join(' ');
}

function sanitizedCause(error: unknown, redactions: readonly string[]): Error {
	const source = error instanceof Error ? error : new Error(String(error));
	const safe = new Error(redactCommandText(source.message, redactions));
	safe.name = redactCommandText(source.name, redactions);
	const code = (source as NodeJS.ErrnoException).code;
	if (code !== undefined) (safe as NodeJS.ErrnoException).code = code;
	return safe;
}

function diagnosticFor(
	description: string,
	outcome: string,
	stdout: string,
	stderr: string,
	redactions: readonly string[]
): string {
	const lines = [`${description}: ${outcome}`];
	const safeStdout = redactCommandText(stdout.trimEnd(), redactions);
	const safeStderr = redactCommandText(stderr.trimEnd(), redactions);
	if (safeStdout) lines.push(`stdout:\n${safeStdout}`);
	if (safeStderr) lines.push(`stderr:\n${safeStderr}`);
	return lines.join('\n');
}

function failureResult(
	kind: CommandFailureKind,
	description: string,
	stdout: string,
	stderr: string,
	redactions: readonly string[],
	details: {
		exitCode?: number;
		signal?: NodeJS.Signals;
		cause?: Error;
	} = {}
): CommandFailure {
	const detail =
		kind === 'non_zero_exit'
			? details.exitCode !== undefined
				? `exited with code ${details.exitCode}`
				: `terminated by ${details.signal ?? 'an unknown signal'}`
			: kind.replaceAll('_', ' ');
	return {
		ok: false,
		kind,
		description,
		stdout,
		stderr,
		diagnostic: diagnosticFor(description, detail, stdout, stderr, redactions),
		...details
	};
}

async function readCapturedOutput(
	stream: AsyncIterable<Uint8Array | string> | null
): Promise<string> {
	if (!stream) return '';
	const decoder = new TextDecoder();
	let output = '';
	for await (const chunk of stream) {
		output += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
	}
	return output + decoder.decode();
}

async function waitForExitOrGrace(
	exited: Promise<CommandExit>,
	graceMs: number,
	createTimer: CommandRunnerDependencies['createTimer']
): Promise<boolean> {
	return await new Promise<boolean>((resolve) => {
		let done = false;
		let cancelTimer: () => void = () => undefined;
		const finish = (exitedBeforeGrace: boolean) => {
			if (done) return;
			done = true;
			cancelTimer();
			resolve(exitedBeforeGrace);
		};
		const timer = createTimer(() => finish(false), graceMs);
		cancelTimer = () => timer.cancel();
		void exited.then(() => finish(true));
	});
}

async function terminateAndWait(
	child: SpawnedCommand,
	exited: Promise<CommandExit>,
	graceMs: number,
	dependencies: CommandRunnerDependencies
): Promise<void> {
	dependencies.killProcessTree(child, 'SIGTERM');
	if (await waitForExitOrGrace(exited, graceMs, dependencies.createTimer)) {
		// The direct child may exit while a descendant ignores SIGTERM. On POSIX
		// the process group still has the child's pid as its id, so a final
		// best-effort SIGKILL closes that orphan path without delaying settlement.
		dependencies.killProcessTree(child, 'SIGKILL');
		return;
	}
	dependencies.killProcessTree(child, 'SIGKILL');
	await exited;
}

function classifySpawnFailure(error: Error): 'not_found' | 'spawn_failed' {
	return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'not_found' : 'spawn_failed';
}

export async function runCommand(
	spec: CommandSpec,
	dependencyOverrides: Partial<CommandRunnerDependencies> = {}
): Promise<CommandResult> {
	validateSpec(spec);
	const dependencies = dependenciesWith(dependencyOverrides);
	const redactions = collectRedactions(spec, dependencies.baseEnv);
	const description = commandDescription(spec, redactions);
	const output = spec.output ?? 'capture';

	if (spec.signal?.aborted) {
		return failureResult('aborted', description, '', '', redactions);
	}

	let child: SpawnedCommand;
	try {
		child = dependencies.spawn({
			command: spec.command,
			args: spec.args ?? [],
			cwd: spec.cwd,
			env: mergeEnvironment(dependencies.baseEnv, spec.env),
			output
		});
	} catch (error) {
		const cause = sanitizedCause(error, redactions);
		return failureResult(classifySpawnFailure(cause), description, '', '', redactions, { cause });
	}

	const stdoutPromise =
		output === 'capture' ? readCapturedOutput(child.stdout) : Promise.resolve('');
	const stderrPromise =
		output === 'capture' ? readCapturedOutput(child.stderr) : Promise.resolve('');

	let exited = false;
	let stopReason: 'aborted' | 'timed_out' | undefined;
	let termination: Promise<void> | undefined;
	const exitPromise = child.exited.then(
		(result) => {
			exited = true;
			return result;
		},
		(error): CommandExit => {
			exited = true;
			return { exitCode: null, signal: null, error: sanitizedCause(error, redactions) };
		}
	);

	const requestStop = (reason: 'aborted' | 'timed_out') => {
		if (exited || stopReason) return;
		stopReason = reason;
		termination = terminateAndWait(
			child,
			exitPromise,
			spec.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS,
			dependencies
		);
	};

	const onAbort = () => requestStop('aborted');
	spec.signal?.addEventListener('abort', onAbort, { once: true });
	if (spec.signal?.aborted) requestStop('aborted');
	const timeout =
		spec.timeoutMs === undefined
			? undefined
			: dependencies.createTimer(() => requestStop('timed_out'), spec.timeoutMs);

	const exit = await exitPromise;
	timeout?.cancel();
	spec.signal?.removeEventListener('abort', onAbort);
	if (termination) await termination;

	const [stdoutRead, stderrRead] = await Promise.allSettled([stdoutPromise, stderrPromise]);
	const stdout = stdoutRead.status === 'fulfilled' ? stdoutRead.value : '';
	const stderr = stderrRead.status === 'fulfilled' ? stderrRead.value : '';
	const streamError =
		stdoutRead.status === 'rejected'
			? stdoutRead.reason
			: stderrRead.status === 'rejected'
				? stderrRead.reason
				: undefined;

	if (stopReason) {
		return failureResult(stopReason, description, stdout, stderr, redactions, {
			exitCode: exit.exitCode ?? undefined,
			signal: exit.signal ?? undefined
		});
	}

	const executionError = exit.error ?? streamError;
	if (executionError !== undefined) {
		const cause = sanitizedCause(executionError, redactions);
		return failureResult(classifySpawnFailure(cause), description, stdout, stderr, redactions, {
			exitCode: exit.exitCode ?? undefined,
			signal: exit.signal ?? undefined,
			cause
		});
	}

	if (exit.exitCode === 0 && exit.signal === null) {
		return {
			ok: true,
			exitCode: 0,
			description,
			stdout,
			stderr,
			diagnostic: diagnosticFor(description, 'exited with code 0', '', '', redactions)
		};
	}

	return failureResult('non_zero_exit', description, stdout, stderr, redactions, {
		exitCode: exit.exitCode ?? undefined,
		signal: exit.signal ?? undefined
	});
}

function validateRetryOptions(options: CommandRetryOptions): void {
	if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) {
		throw new RangeError('maxAttempts must be a positive integer');
	}
	if (!options.delay) return;
	if (options.delay.kind === 'fixed') {
		assertNonNegative('delay.delayMs', options.delay.delayMs);
		return;
	}
	assertNonNegative('delay.initialDelayMs', options.delay.initialDelayMs);
	assertNonNegative('delay.maxDelayMs', options.delay.maxDelayMs);
	const multiplier = options.delay.multiplier ?? 2;
	if (!Number.isFinite(multiplier) || multiplier < 1) {
		throw new RangeError('delay.multiplier must be a finite number of at least 1');
	}
}

function retryDelayMs(policy: RetryDelayPolicy | undefined, attempt: number): number {
	if (!policy) return 0;
	if (policy.kind === 'fixed') return policy.delayMs;
	const delay = policy.initialDelayMs * (policy.multiplier ?? 2) ** (attempt - 1);
	return Math.min(delay, policy.maxDelayMs ?? Number.POSITIVE_INFINITY);
}

function defaultShouldRetry(result: CommandFailure): boolean {
	return result.kind === 'non_zero_exit' || result.kind === 'spawn_failed';
}

export async function runCommandWithRetry(
	spec: CommandSpec,
	options: CommandRetryOptions,
	dependencyOverrides: Partial<CommandRunnerDependencies> = {}
): Promise<CommandRetryResult> {
	validateSpec(spec);
	validateRetryOptions(options);
	const dependencies = dependenciesWith(dependencyOverrides);
	const shouldRetry = options.shouldRetry ?? defaultShouldRetry;

	if (spec.signal?.aborted) {
		const redactions = collectRedactions(spec, dependencies.baseEnv);
		return {
			result: failureResult('aborted', commandDescription(spec, redactions), '', '', redactions),
			attempts: 0
		};
	}

	for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
		const result = await runCommand(spec, dependencies);
		if (result.ok) return { result, attempts: attempt };

		const stopped = result.kind === 'aborted' || result.kind === 'timed_out';
		const willRetry = !stopped && attempt < options.maxAttempts && shouldRetry(result, attempt);
		const nextDelayMs = willRetry ? retryDelayMs(options.delay, attempt) : null;
		await options.onFailedAttempt?.({
			result,
			attempt,
			maxAttempts: options.maxAttempts,
			willRetry,
			nextDelayMs
		});
		if (!willRetry) return { result, attempts: attempt };

		try {
			await dependencies.sleep(nextDelayMs ?? 0, spec.signal);
		} catch (error) {
			if (!isAbortError(error)) throw error;
			const redactions = collectRedactions(spec, dependencies.baseEnv);
			return {
				result: failureResult('aborted', commandDescription(spec, redactions), '', '', redactions),
				attempts: attempt
			};
		}
	}

	throw new Error('unreachable retry state');
}
