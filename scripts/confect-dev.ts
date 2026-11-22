import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, rmSync, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { withCheckoutLock } from './checkout-lock';
import {
	applyWriteSets,
	bunExecutable,
	CONFECT_GENERATED_DIR,
	CONVEX_DIR,
	withScratchCodegen,
	type Codegen,
	type StageResult
} from './confect-stage';
import { generateAuthoredContent } from './generate-authored-content';
import { computeLocalConvexStateId, type LocalConvexMode } from './local-convex-env';

export const CONFECT_DEV_ENABLED = false;

const STARTUP_DEADLINE_MS = 300_000;
const STARTUP_POLL_MS = 100;
const PUSH_TIMEOUT_MS = 120_000;
const ENV_SCHEMA = '.env-convex.schema';
const RESTART_FILES: ReadonlySet<string> = new Set([
	'convex.json',
	'package.json',
	'bun.lock',
	'vite.config.ts'
]);
const AUTHORED_CONVEX_FILES: ReadonlySet<string> = new Set([
	`${CONVEX_DIR}/convex.config.ts`,
	`${CONVEX_DIR}/tsconfig.json`
]);
const GENERATED_PROMPT = 'src/lib/confect/support/instructions.generated.ts';

const LOCAL_FILES = {
	dev: { status: 'startup-dev.json', backendUrl: '.backend-url', stateIdSuffix: undefined },
	'dev:test': {
		status: 'startup-dev-test.json',
		backendUrl: '.test-backend-url',
		stateIdSuffix: 'e2e'
	}
} as const satisfies Record<
	LocalConvexMode,
	{ status: string; backendUrl: string; stateIdSuffix: string | undefined }
>;

export class StartupError extends Error {
	override name = 'StartupError';
}

export type StartupCheck =
	| { state: 'pending' }
	| { state: 'ready'; backendUrl: string }
	| { state: 'failed'; reason: string };

type StartupStatus = {
	outcome: 'success' | 'failure';
	backendUrl: string;
	nonce: string;
	mode: string;
};

export type ChangeKind = 'source' | 'restart' | 'ignored';

export type LocalCredentials = { backendUrl: string; adminKey: string };

export type Push = (scratch: string, signal: AbortSignal) => Promise<void>;

export type RunOptions = {
	root: string;
	push: Push;
	signal: AbortSignal;
	log: (line: string) => void;
	codegen?: Codegen;
	generateContent?: () => void;
};

type GenerateOptions = Pick<RunOptions, 'codegen' | 'generateContent'> & { signal?: AbortSignal };

const log = (line: string) => console.log(`[confect-dev] ${line}`);

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function parseStartupStatus(text: string): StartupStatus | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (
		typeof parsed !== 'object' ||
		parsed === null ||
		Object.keys(parsed).sort().join(',') !== 'backendUrl,mode,nonce,outcome' ||
		!('outcome' in parsed) ||
		!('backendUrl' in parsed) ||
		!('nonce' in parsed) ||
		!('mode' in parsed)
	) {
		return undefined;
	}
	const { outcome, backendUrl, nonce, mode } = parsed;
	if (outcome !== 'success' && outcome !== 'failure') return undefined;
	if (typeof backendUrl !== 'string' || typeof nonce !== 'string' || typeof mode !== 'string') {
		return undefined;
	}
	return { outcome, backendUrl, nonce, mode };
}

export function checkStartupStatus(
	text: string | undefined,
	expected: { mode: LocalConvexMode; nonce: string; backendUrl: string | undefined }
): StartupCheck {
	if (text === undefined) return { state: 'pending' };
	const status = parseStartupStatus(text);
	if (status === undefined) return { state: 'failed', reason: 'the startup marker is invalid' };
	if (status.nonce !== expected.nonce) {
		return { state: 'failed', reason: 'the startup marker belongs to another start' };
	}
	if (status.mode !== expected.mode) {
		return { state: 'failed', reason: `the startup marker belongs to ${status.mode}` };
	}
	if (status.outcome === 'failure') {
		return { state: 'failed', reason: 'the backend reported a failed startup' };
	}
	if (status.backendUrl !== expected.backendUrl) return { state: 'pending' };
	return { state: 'ready', backendUrl: status.backendUrl };
}

export async function awaitStartup({
	read,
	exited,
	signal,
	deadlineMs = STARTUP_DEADLINE_MS
}: {
	read: () => StartupCheck;
	exited: Promise<number>;
	signal: AbortSignal;
	deadlineMs?: number;
}): Promise<string> {
	let exitCode: number | undefined;
	void exited.then((code) => {
		exitCode = code;
	});
	const deadline = Date.now() + deadlineMs;
	for (;;) {
		const check = read();
		if (check.state === 'ready') return check.backendUrl;
		if (check.state === 'failed') throw new StartupError(check.reason);
		if (exitCode !== undefined) {
			throw new StartupError(`Vite exited with ${exitCode} before the startup marker`);
		}
		if (Date.now() >= deadline) {
			throw new StartupError(`no startup marker within ${deadlineMs} ms`);
		}
		await delay(STARTUP_POLL_MS, undefined, { signal });
	}
}

export function createRunQueue() {
	let pending = false;
	let run: (() => Promise<void>) | undefined;
	let active: Promise<void> | undefined;
	const kick = () => {
		if (run === undefined || active !== undefined || !pending) return;
		pending = false;
		active = run().finally(() => {
			active = undefined;
			kick();
		});
	};
	return {
		request: () => {
			pending = true;
			kick();
		},
		open: (next: () => Promise<void>) => {
			run = next;
			kick();
		},
		settled: () => active ?? Promise.resolve()
	};
}

export function classifyChange(file: string): ChangeKind {
	if (RESTART_FILES.has(file)) return 'restart';
	if (file === ENV_SCHEMA) return 'source';
	if (!file.startsWith('src/')) return 'ignored';
	if (file === GENERATED_PROMPT) return 'ignored';
	if (file === CONFECT_GENERATED_DIR || file.startsWith(`${CONFECT_GENERATED_DIR}/`)) {
		return 'ignored';
	}
	if (file === CONVEX_DIR || file.startsWith(`${CONVEX_DIR}/`)) {
		return AUTHORED_CONVEX_FILES.has(file) ? 'source' : 'ignored';
	}
	return 'source';
}

export function createChangeFilter(since = Date.now()): (file: string) => boolean {
	const seen = new Map<string, number>();
	return (file) => {
		let changedAt: number;
		try {
			changedAt = lstatSync(file).ctimeMs;
		} catch {
			seen.delete(file);
			return true;
		}
		const previous = seen.get(file) ?? since;
		seen.set(file, Math.max(previous, changedAt));
		return changedAt > previous;
	};
}

export function watchCheckout(
	root: string,
	handlers: { onSource: () => void; onRestart: (file: string) => void }
): Pick<FSWatcher, 'close'> {
	const changed = createChangeFilter();
	const dispatch = (file: string) => {
		const kind = classifyChange(file);
		if (kind === 'ignored' || !changed(path.join(root, file))) return;
		if (kind === 'source') handlers.onSource();
		else if (kind === 'restart') handlers.onRestart(file);
	};
	const source = watch(path.join(root, 'src'), { recursive: true }, (_event, filename) => {
		if (filename === null) handlers.onSource();
		else dispatch(`src/${filename.toString().split(path.sep).join('/')}`);
	});
	const top = watch(root, (_event, filename) => {
		if (filename !== null) dispatch(filename.toString());
	});
	return {
		close: () => {
			source.close();
			top.close();
		}
	};
}

function watchCheckoutForRuns(root: string, request: () => void): Pick<FSWatcher, 'close'> {
	const announced = new Set<string>();
	return watchCheckout(root, {
		onSource: request,
		onRestart: (file) => {
			if (announced.has(file)) return;
			announced.add(file);
			log(`${file} changed. Restart the dev server to apply it.`);
		}
	});
}

function regenerate(
	root: string,
	options: GenerateOptions & { push?: Push }
): Promise<StageResult> {
	(options.generateContent ?? generateAuthoredContent)();
	return withScratchCodegen(
		root,
		async (scratch) => {
			if (options.push && options.signal) await options.push(scratch, options.signal);
			return applyWriteSets(scratch, root);
		},
		{ codegen: options.codegen }
	);
}

export function confectPreflight(
	root: string,
	options: GenerateOptions = {}
): Promise<StageResult> {
	return withCheckoutLock(root, () => regenerate(root, options), {
		signal: options.signal,
		onWait: () => log('Waiting for the checkout lock.')
	});
}

export function createRun(options: RunOptions): () => Promise<void> {
	return async () => {
		try {
			const result = await withCheckoutLock(options.root, () => regenerate(options.root, options), {
				signal: options.signal,
				onWait: () => options.log('Waiting for the checkout lock.')
			});
			const written = result.added.length + result.changed.length + result.removed.length;
			options.log(`Pushed. ${written} generated files changed.`);
		} catch (error) {
			if (options.signal.aborted) return;
			options.log(`Run failed: ${message(error)}. Waiting for the next change.`);
		}
	};
}

export function localPushCommand(credentials: LocalCredentials): string[] {
	return [
		bunExecutable(),
		'x',
		'convex',
		'deploy',
		'--admin-key',
		credentials.adminKey,
		'--url',
		credentials.backendUrl
	];
}

export function cloudPushCommand(args: readonly string[]): string[] {
	return [bunExecutable(), 'x', 'convex', 'dev', '--once', ...args];
}

function exitOf(child: ChildProcess): Promise<number> {
	return new Promise((resolve) => {
		child.once('error', () => resolve(1));
		child.once('exit', (code) => resolve(code ?? 1));
	});
}

export function commandPush(command: readonly string[], env: NodeJS.ProcessEnv): Push {
	return async (scratch, signal) => {
		const [file, ...args] = command;
		if (file === undefined) throw new Error('The push command is empty.');
		const child = spawn(file, args, {
			cwd: scratch,
			env,
			signal,
			stdio: ['ignore', 'inherit', 'inherit'],
			timeout: PUSH_TIMEOUT_MS
		});
		const code = await exitOf(child);
		if (code !== 0) throw new Error(`the push exited with ${code}`);
	};
}

function readText(file: string): string | undefined {
	try {
		return readFileSync(file, 'utf8');
	} catch {
		return undefined;
	}
}

export function readAdminKey(root: string, mode: LocalConvexMode): string {
	const keys = path.join(
		root,
		'.convex',
		computeLocalConvexStateId(root, LOCAL_FILES[mode].stateIdSuffix),
		'keys.json'
	);
	const text = readText(keys);
	let parsed: unknown;
	try {
		parsed = text === undefined ? undefined : JSON.parse(text);
	} catch {
		parsed = undefined;
	}
	if (
		typeof parsed === 'object' &&
		parsed !== null &&
		'adminKey' in parsed &&
		typeof parsed.adminKey === 'string'
	) {
		return parsed.adminKey;
	}
	throw new StartupError(`${keys} holds no admin key`);
}

function onShutdown(stop: (signal: NodeJS.Signals) => void): void {
	process.on('SIGINT', () => stop('SIGINT'));
	process.on('SIGTERM', () => stop('SIGTERM'));
}

export async function runLocalConfectDev({
	mode,
	command,
	env,
	root = process.cwd()
}: {
	mode: LocalConvexMode;
	command: readonly string[];
	env: NodeJS.ProcessEnv;
	root?: string;
}): Promise<number> {
	const controller = new AbortController();
	const queue = createRunQueue();
	const watcher = watchCheckoutForRuns(root, queue.request);
	const files = LOCAL_FILES[mode];
	const statusFile = path.join(root, '.convex', files.status);
	const urlFile = path.join(root, '.convex', files.backendUrl);
	const nonce = randomUUID();
	const backend = () =>
		checkStartupStatus(readText(statusFile), {
			mode,
			nonce,
			backendUrl: readText(urlFile)?.trim()
		});
	let vite: ChildProcess | undefined;
	let exited: Promise<number> = Promise.resolve(1);
	onShutdown((signal) => {
		controller.abort();
		vite?.kill(signal);
	});
	const [file, ...args] = command;
	try {
		if (file === undefined) throw new StartupError('The Vite command is empty.');
		const backendUrl = await withCheckoutLock(
			root,
			async () => {
				await regenerate(root, {});
				rmSync(statusFile, { force: true });
				rmSync(urlFile, { force: true });
				vite = spawn(file, args, {
					stdio: 'inherit',
					env: {
						...env,
						CONVEX_STARTUP_STATUS_FILE: statusFile,
						CONVEX_STARTUP_NONCE: nonce,
						CONVEX_STARTUP_MODE: mode
					}
				});
				exited = exitOf(vite);
				return awaitStartup({ read: backend, exited, signal: controller.signal });
			},
			{ signal: controller.signal, onWait: () => log('Waiting for the checkout lock.') }
		);
		const adminKey = readAdminKey(root, mode);
		queue.open(
			createRun({
				root,
				push: async (scratch, signal) => {
					const current = await awaitStartup({ read: backend, exited, signal });
					await commandPush(localPushCommand({ backendUrl: current, adminKey }), env)(
						scratch,
						signal
					);
				},
				signal: controller.signal,
				log
			})
		);
		log(`Backend ready at ${backendUrl}. Watching for changes.`);
	} catch (error) {
		watcher.close();
		if (!controller.signal.aborted) log(`Startup failed: ${message(error)}.`);
		vite?.kill('SIGTERM');
		const code = await exited;
		return controller.signal.aborted ? code : Math.max(code, 1);
	}
	const code = await exited;
	controller.abort();
	watcher.close();
	await queue.settled();
	return code;
}

export async function runCloudConfectDev({
	args,
	env,
	root = process.cwd()
}: {
	args: readonly string[];
	env: NodeJS.ProcessEnv;
	root?: string;
}): Promise<number> {
	const controller = new AbortController();
	const queue = createRunQueue();
	const watcher = watchCheckoutForRuns(root, queue.request);
	const stopped = new Promise<void>((resolve) => {
		onShutdown(() => {
			controller.abort();
			resolve();
		});
	});
	queue.open(
		createRun({
			root,
			push: commandPush(cloudPushCommand(args), env),
			signal: controller.signal,
			log
		})
	);
	queue.request();
	await stopped;
	watcher.close();
	await queue.settled();
	return 0;
}
