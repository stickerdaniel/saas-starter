import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, rmSync, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { withCheckoutLock } from './checkout-lock';
import {
	bunExecutable,
	CONFECT_GENERATED_DIR,
	CONVEX_DIR,
	regenerate,
	type Codegen,
	type Push
} from './confect-codegen';
import { computeLocalConvexStateId, type LocalConvexMode } from './local-convex-env';

const STARTUP_DEADLINE_MS = 300_000;
const STARTUP_POLL_MS = 100;
const PUSH_LIMITS: PushLimits = { timeoutMs: 120_000, graceMs: 5_000 };
const ENV_SCHEMA = '.env-convex.schema';
const RESTART_FILES: ReadonlySet<string> = new Set(['convex.json', 'package.json', 'bun.lock']);
const OWN_RESTART_FILES = [fileURLToPath(new URL('./local-convex-binary.ts', import.meta.url))];
const AUTHORED_CONVEX_FILES: ReadonlySet<string> = new Set([
	`${CONVEX_DIR}/convex.config.ts`,
	`${CONVEX_DIR}/tsconfig.json`
]);
const DEPLOYMENT_SELECTION = [
	'CONVEX_DEPLOYMENT',
	'CONVEX_SELF_HOSTED_URL',
	'CONVEX_SELF_HOSTED_ADMIN_KEY'
] as const;
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

export type RunOptions = {
	root: string;
	push: Push;
	signal: AbortSignal;
	log: (line: string) => void;
	codegen?: Codegen;
	generateContent?: () => void;
};

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
		await Promise.resolve();
		if (exitCode !== undefined) {
			throw new StartupError(`Vite exited with ${exitCode} before the startup marker`);
		}
		const check = read();
		if (check.state === 'ready') return check.backendUrl;
		if (check.state === 'failed') throw new StartupError(check.reason);
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

function digestOf(file: string): string | undefined {
	try {
		return createHash('sha256').update(readFileSync(file)).digest('hex');
	} catch {
		return undefined;
	}
}

const slashed = (file: string) => file.split(path.sep).join('/');

export function watchCheckout(
	root: string,
	restartFiles: readonly string[],
	handlers: { onSource: () => void; onRestart: (file: string) => void }
): Pick<FSWatcher, 'close'> {
	const changed = createChangeFilter();
	const checkout = realpathSync.native(root);
	const schema = path.join(checkout, ENV_SCHEMA);
	const named = new Set([
		schema,
		...[...RESTART_FILES].map((file) => path.join(checkout, file)),
		...restartFiles.map((file) => realpathSync.native(file))
	]);
	const digests = new Map<string, string | undefined>();
	const compare = (file: string) => {
		if (!named.has(file)) return;
		const digest = digestOf(file);
		if (digest === digests.get(file)) return;
		digests.set(file, digest);
		if (file === schema) handlers.onSource();
		else handlers.onRestart(slashed(path.relative(checkout, file)));
	};
	const dispatch = (file: string) => {
		if (classifyChange(file) !== 'source' || !changed(path.join(checkout, file))) return;
		handlers.onSource();
	};
	const source = watch(path.join(checkout, 'src'), { recursive: true }, (_event, filename) => {
		if (filename === null) handlers.onSource();
		else dispatch(`src/${slashed(filename.toString())}`);
	});
	const directories = new Set([...named].map((file) => path.dirname(file)));
	const watchers = [
		source,
		...[...directories].map((directory) =>
			watch(directory, (_event, filename) => {
				if (filename !== null) compare(path.join(directory, filename.toString()));
			})
		)
	];
	for (const file of named) digests.set(file, digestOf(file));
	return {
		close: () => {
			for (const watcher of watchers) watcher.close();
		}
	};
}

export function watchCheckoutForRuns({
	root,
	restartFiles,
	request,
	log
}: {
	root: string;
	restartFiles: readonly string[];
	request: () => void;
	log: (line: string) => void;
}): Pick<FSWatcher, 'close'> {
	const announced = new Set<string>();
	return watchCheckout(root, restartFiles, {
		onSource: request,
		onRestart: (file) => {
			if (announced.has(file)) return;
			announced.add(file);
			log(`${file} changed. Restart the dev server to apply it.`);
		}
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

export function cloudPushEnv(root: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const local = readText(path.join(root, '.env.local'));
	const selected = local === undefined ? {} : parseEnv(local);
	const forwarded: NodeJS.ProcessEnv = { ...env };
	for (const key of DEPLOYMENT_SELECTION) {
		const value = selected[key];
		if (forwarded[key] === undefined && value !== undefined && value !== '') forwarded[key] = value;
	}
	return forwarded;
}

export function cloudPushCommand(args: readonly string[]): string[] {
	return [bunExecutable(), 'x', 'convex', 'dev', '--once', ...args];
}

function exitOf(child: ChildProcess): Promise<number> {
	return new Promise((resolve) => {
		child.once('error', () => {
			if (child.pid === undefined) resolve(1);
		});
		child.once('exit', (code) => resolve(code ?? 1));
	});
}

type PushLimits = { readonly timeoutMs: number; readonly graceMs: number };

type PushEnd =
	| { readonly kind: 'exited'; readonly code: number }
	| { readonly kind: 'timed-out' }
	| { readonly kind: 'cancelled' }
	| { readonly kind: 'not-started' };

function endOf(child: ChildProcess, signal: AbortSignal, limits: PushLimits): Promise<PushEnd> {
	return new Promise((resolve) => {
		let stopped: 'timed-out' | 'cancelled' | undefined;
		let forceKill: NodeJS.Timeout | undefined;
		const stop = (reason: 'timed-out' | 'cancelled') => {
			if (stopped !== undefined) return;
			stopped = reason;
			child.kill('SIGTERM');
			forceKill = setTimeout(() => child.kill('SIGKILL'), limits.graceMs);
		};
		const cancel = () => stop('cancelled');
		const deadline = setTimeout(() => stop('timed-out'), limits.timeoutMs);
		const settle = (end: PushEnd) => {
			clearTimeout(deadline);
			clearTimeout(forceKill);
			signal.removeEventListener('abort', cancel);
			resolve(end);
		};
		signal.addEventListener('abort', cancel, { once: true });
		child.once('error', () => {
			if (child.pid === undefined) settle({ kind: 'not-started' });
		});
		child.once('exit', (code) =>
			settle(stopped === undefined ? { kind: 'exited', code: code ?? 1 } : { kind: stopped })
		);
	});
}

export function commandPush(
	command: readonly string[],
	env: NodeJS.ProcessEnv,
	limits: PushLimits = PUSH_LIMITS
): Push {
	return async (scratch, signal) => {
		const [file, ...args] = command;
		if (file === undefined) throw new Error('The push command is empty.');
		signal.throwIfAborted();
		const child = spawn(file, args, { cwd: scratch, env, stdio: ['ignore', 'inherit', 'inherit'] });
		const end = await endOf(child, signal, limits);
		if (end.kind === 'not-started') throw new Error('the push did not start');
		if (end.kind === 'timed-out')
			throw new Error(`the push timed out after ${limits.timeoutMs} ms`);
		if (end.kind === 'cancelled') throw new Error('the push was cancelled');
		if (end.code !== 0) throw new Error(`the push exited with ${end.code}`);
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
	restartFiles,
	env,
	root = process.cwd()
}: {
	mode: LocalConvexMode;
	command: readonly string[];
	restartFiles: readonly string[];
	env: NodeJS.ProcessEnv;
	root?: string;
}): Promise<number> {
	const controller = new AbortController();
	const queue = createRunQueue();
	const watcher = watchCheckoutForRuns({
		root,
		restartFiles: [...restartFiles, ...OWN_RESTART_FILES],
		request: queue.request,
		log
	});
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
	restartFiles,
	env,
	root = process.cwd()
}: {
	args: readonly string[];
	restartFiles: readonly string[];
	env: NodeJS.ProcessEnv;
	root?: string;
}): Promise<number> {
	const controller = new AbortController();
	const queue = createRunQueue();
	const watcher = watchCheckoutForRuns({
		root,
		restartFiles: [...restartFiles, ...OWN_RESTART_FILES],
		request: queue.request,
		log
	});
	const stopped = new Promise<void>((resolve) => {
		onShutdown(() => {
			controller.abort();
			resolve();
		});
	});
	queue.open(
		createRun({
			root,
			push: commandPush(cloudPushCommand(args), cloudPushEnv(root, env)),
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
