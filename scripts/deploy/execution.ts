import {
	runCommand,
	runCommandWithRetry,
	type CommandFailure,
	type CommandRetryOptions,
	type CommandRunnerDependencies,
	type CommandSpec,
	type CommandSuccess
} from '../process/command-runner';

export type ExecutionControls = Pick<CommandSpec, 'signal' | 'timeoutMs'>;

export class DeploymentError extends Error {
	constructor(
		readonly code:
			| 'configuration'
			| 'command_failed'
			| 'aborted'
			| 'timed_out'
			| 'prune_blocked'
			| 'request_failed',
		message: string,
		readonly exitCode?: number
	) {
		super(message);
		this.name = 'DeploymentError';
	}
}

export function commandError(message: string, result: CommandFailure): DeploymentError {
	// Captures can contain runtime secrets that are not in the build environment
	// (notably `convex env list`). Never print captures at a deployment boundary.
	return new DeploymentError(
		result.kind === 'aborted' || result.kind === 'timed_out' ? result.kind : 'command_failed',
		`${message}\n${result.description}: ${result.kind}${result.exitCode === undefined ? '' : ` (exit ${result.exitCode})`}`,
		result.kind === 'non_zero_exit' ? result.exitCode : undefined
	);
}

export function requireCommand(
	result: CommandSuccess | CommandFailure,
	message: string
): asserts result is CommandSuccess {
	if (!result.ok) throw commandError(message, result);
}

export function throwIfStopped(result: CommandSuccess | CommandFailure): void {
	if (!result.ok && (result.kind === 'aborted' || result.kind === 'timed_out')) {
		throw commandError('Deployment interrupted.', result);
	}
}

export function checkAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DeploymentError('aborted', 'Deployment aborted.');
}

/** One invocation owns its environment; preview keys never mutate the host process. */
export function createDeploymentExecution(
	options: ExecutionControls & {
		env?: NodeJS.ProcessEnv;
		runner?: Partial<CommandRunnerDependencies>;
	} = {}
) {
	const env = { ...(options.env ?? process.env) };
	// A bounded per-command budget, not a timeout of the entire deployment.
	const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000;
	const signal = options.signal;
	const specWithControls = (spec: CommandSpec): CommandSpec => ({
		timeoutMs,
		...spec,
		signal,
		env: { ...env, ...spec.env }
	});
	// No alternate execution/retry implementation: both route to the PR 6A boundary.
	return {
		env,
		signal,
		timeoutMs,
		run: (spec: CommandSpec) =>
			runCommand(specWithControls(spec), { ...options.runner, baseEnv: env }),
		retry: (spec: CommandSpec, retry: CommandRetryOptions) =>
			runCommandWithRetry(specWithControls(spec), retry, { ...options.runner, baseEnv: env })
	};
}

export type DeploymentExecution = ReturnType<typeof createDeploymentExecution>;

/** Management requests are HTTP, not subprocesses. Bound response-body reads too. */
export async function requestJson(
	url: string,
	init: RequestInit,
	execution: ExecutionControls = {},
	responseType: 'json' | 'empty' = 'json'
): Promise<unknown> {
	checkAborted(execution.signal);
	const controller = new AbortController();
	const onAbort = () => controller.abort();
	execution.signal?.addEventListener('abort', onAbort, { once: true });
	let timedOut = false;
	const timer = setTimeout(
		() => {
			timedOut = true;
			controller.abort();
		},
		Math.min(execution.timeoutMs ?? 30_000, 30_000)
	);
	try {
		const response = await fetch(url, { ...init, signal: controller.signal });
		if (!response.ok) {
			await response.body?.cancel();
			throw new DeploymentError(
				'request_failed',
				`Management request failed (HTTP ${response.status}).`
			);
		}
		const body: unknown =
			responseType === 'json' ? await response.json() : await response.body?.cancel();
		checkAborted(execution.signal);
		if (timedOut) throw new DeploymentError('timed_out', 'Management request timed out.');
		return body;
	} catch (error) {
		checkAborted(execution.signal);
		if (timedOut) throw new DeploymentError('timed_out', 'Management request timed out.');
		if (error instanceof DeploymentError) throw error;
		// Provider response bodies, request headers, and network causes stay internal.
		throw new DeploymentError('request_failed', 'Management request failed.');
	} finally {
		clearTimeout(timer);
		execution.signal?.removeEventListener('abort', onAbort);
	}
}
