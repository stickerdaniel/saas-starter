import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import * as v from 'valibot';
import { readAdminKey } from './confect-dev';
import { LOCAL_CONVEX_BINARY_VERSION } from './local-convex-binary';
import { required } from './required';

export const MAX_LOAD_AVERAGE = 8;
const REQUEST_DEADLINE_MS = 10_000;
const RUNS = 100;
const WARMUP = 10;
const ATTEMPTS = 3;

function oneMinuteLoad() {
	if (process.platform === 'win32') throw new Error('No load average on Windows');
	return required(os.loadavg()[0], 'load average');
}

export type FunctionKind = 'query' | 'mutation';

const logEntrySchema = v.looseObject({
	kind: v.string(),
	identifier: v.optional(v.string()),
	cachedResult: v.optional(v.boolean()),
	userExecutionTime: v.optional(v.nullable(v.number())),
	willRetry: v.optional(v.nullable(v.boolean())),
	error: v.optional(v.nullable(v.string())),
	identityType: v.optional(v.string())
});

const logPageSchema = v.object({
	entries: v.array(v.unknown()),
	newCursor: v.number()
});

export type LogEntry = v.InferOutput<typeof logEntrySchema>;
export type LogPage = { entries: LogEntry[]; newCursor: number };

export function parseLogPage(body: unknown): LogPage {
	const page = v.parse(logPageSchema, body);
	const entries = page.entries.flatMap((entry) => {
		const parsed = v.safeParse(logEntrySchema, entry);
		return parsed.success ? [parsed.output] : [];
	});
	return { entries, newCursor: page.newCursor };
}

export type Execution =
	| { kind: 'executed'; userExecutionMs: number | undefined }
	| { kind: 'cached' }
	| { kind: 'failed'; error: string }
	| { kind: 'ambiguous'; completions: number }
	| { kind: 'wrongIdentity'; identityType: string | undefined };

export const actingIdentitySchema = v.looseObject({
	subject: v.string(),
	issuer: v.string(),
	sessionId: v.string()
});

export type ActingIdentity = v.InferOutput<typeof actingIdentitySchema>;

export const identityTypesFor = (identity: ActingIdentity | undefined): readonly string[] =>
	identity ? ['member_acting_user', 'team_acting_user'] : ['instance_admin'];

export function authorization(
	adminKey: string,
	identity: ActingIdentity | undefined,
	nonce: string
): string {
	if (!identity) return `Convex ${adminKey}`;
	const claims = JSON.stringify({ ...identity, latencyProbeCall: nonce });
	return `Convex ${adminKey}:${Buffer.from(claims).toString('base64')}`;
}

const completionsOf = (entries: readonly LogEntry[], identifier: string) =>
	entries.filter((entry) => entry.kind === 'Completion' && entry.identifier === identifier);

export function executionOf(
	entries: readonly LogEntry[],
	identifier: string,
	identityTypes: readonly string[]
): Execution | undefined {
	const all = completionsOf(entries, identifier);
	const completions = all.filter((entry) => entry.willRetry === false);
	const [completion] = completions;
	const unflagged = all.some((entry) => typeof entry.willRetry !== 'boolean');
	if (completion === undefined && !unflagged) return undefined;
	if (completion === undefined || unflagged || completions.length > 1) {
		return { kind: 'ambiguous', completions: all.length };
	}
	const { identityType } = completion;
	if (identityType === undefined || !identityTypes.includes(identityType)) {
		return { kind: 'wrongIdentity', identityType };
	}
	if (completion.error) return { kind: 'failed', error: completion.error };
	if (completion.cachedResult !== false) return { kind: 'cached' };
	const seconds = completion.userExecutionTime;
	return {
		kind: 'executed',
		userExecutionMs: typeof seconds === 'number' ? seconds * 1000 : undefined
	};
}

export function percentile(samples: readonly number[], p: 50 | 95): number {
	if (samples.length === 0) throw new Error('percentile of no samples');
	const sorted = [...samples].sort((a, b) => a - b);
	if (p === 50) {
		const mid = sorted.length >> 1;
		const at = (index: number) => required(sorted[index], 'percentile sample');
		return sorted.length % 2 ? at(mid) : (at(mid - 1) + at(mid)) / 2;
	}
	return required(sorted[Math.ceil((p / 100) * sorted.length) - 1], 'percentile sample');
}

export type LoadReading = { start: number; end: number };

export function countsUnderLoad(load: LoadReading, max = MAX_LOAD_AVERAGE): boolean {
	return load.start <= max && load.end <= max;
}

export type CallSample = { roundTripMs: number; execution: Execution | undefined };

export type Attempt = {
	load: LoadReading;
	counted: boolean;
	roundTrip: { p50Ms: number; p95Ms: number; minMs: number; maxMs: number };
	executed: number;
	notExecuted: {
		cached: number;
		failed: number;
		missing: number;
		ambiguous: number;
		wrongIdentity: number;
	};
	lateCompletions: number;
	userExecution:
		{ proven: true; p50Ms: number; p95Ms: number } | { proven: false; callsWithoutField: number };
};

const round = (value: number) => Number(value.toFixed(3));

export function summarizeAttempt(
	samples: readonly CallSample[],
	load: LoadReading,
	lateCompletions: number
): Attempt {
	const roundTrips = samples.map((sample) => sample.roundTripMs);
	const notExecuted = { cached: 0, failed: 0, missing: 0, ambiguous: 0, wrongIdentity: 0 };
	const userExecution: number[] = [];
	let withoutField = 0;
	for (const { execution } of samples) {
		if (execution === undefined) notExecuted.missing++;
		else if (execution.kind !== 'executed') notExecuted[execution.kind]++;
		else if (execution.userExecutionMs === undefined) withoutField++;
		else userExecution.push(execution.userExecutionMs);
	}
	const executed = samples.length - Object.values(notExecuted).reduce((a, b) => a + b, 0);
	const allExecuted = executed === samples.length;
	return {
		load,
		counted: allExecuted && withoutField === 0 && lateCompletions === 0 && countsUnderLoad(load),
		roundTrip: {
			p50Ms: round(percentile(roundTrips, 50)),
			p95Ms: round(percentile(roundTrips, 95)),
			minMs: round(Math.min(...roundTrips)),
			maxMs: round(Math.max(...roundTrips))
		},
		executed,
		notExecuted,
		lateCompletions,
		userExecution:
			allExecuted && withoutField === 0
				? {
						proven: true,
						p50Ms: round(percentile(userExecution, 50)),
						p95Ms: round(percentile(userExecution, 95))
					}
				: { proven: false, callsWithoutField: withoutField + (samples.length - executed) }
	};
}

type Backend = { url: string; adminKey: string };

async function call(backend: Backend, options: RunOptions) {
	const response = await fetch(`${backend.url}/api/${options.kind}`, {
		method: 'POST',
		headers: {
			Authorization: authorization(backend.adminKey, options.identity, crypto.randomUUID()),
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ path: options.identifier, args: options.args, format: 'json' }),
		signal: AbortSignal.timeout(REQUEST_DEADLINE_MS)
	});
	const body: unknown = await response.json();
	if (!response.ok || !v.is(v.object({ status: v.literal('success') }), body)) {
		throw new Error(
			`${options.identifier} failed with HTTP ${response.status}: ${JSON.stringify(body)}`
		);
	}
}

async function readLogs(backend: Backend, cursor: number, signal: AbortSignal): Promise<LogPage> {
	const response = await fetch(`${backend.url}/api/stream_function_logs?cursor=${cursor}`, {
		headers: { Authorization: `Convex ${backend.adminKey}` },
		signal
	});
	if (!response.ok) throw new Error(`log stream answered HTTP ${response.status}`);
	return parseLogPage(await response.json());
}

async function currentCursor(backend: Backend): Promise<number> {
	const signal = AbortSignal.timeout(REQUEST_DEADLINE_MS);
	try {
		return (await readLogs(backend, 0, signal)).newCursor;
	} catch (error) {
		if (signal.aborted) return 0;
		throw error;
	}
}

async function awaitExecution(backend: Backend, options: RunOptions, cursor: number) {
	const identityTypes = identityTypesFor(options.identity);
	const signal = AbortSignal.timeout(REQUEST_DEADLINE_MS);
	const seen: LogEntry[] = [];
	let next = cursor;
	while (true) {
		let page: LogPage;
		try {
			page = await readLogs(backend, next, signal);
		} catch (error) {
			if (signal.aborted) {
				return { execution: executionOf(seen, options.identifier, identityTypes), cursor: next };
			}
			throw error;
		}
		seen.push(...page.entries);
		next = page.newCursor;
		const execution = executionOf(seen, options.identifier, identityTypes);
		if (execution !== undefined) return { execution, cursor: next };
	}
}

async function countLateCompletions(backend: Backend, identifier: string, cursor: number) {
	const signal = AbortSignal.timeout(REQUEST_DEADLINE_MS);
	const seen: LogEntry[] = [];
	let next = cursor;
	while (true) {
		try {
			const page = await readLogs(backend, next, signal);
			seen.push(...page.entries);
			next = page.newCursor;
		} catch (error) {
			if (signal.aborted) return completionsOf(seen, identifier).length;
			throw error;
		}
	}
}

export type RunOptions = {
	identifier: string;
	kind: FunctionKind;
	args: unknown;
	identity: ActingIdentity | undefined;
};

async function measure(backend: Backend, options: RunOptions): Promise<Attempt> {
	let cursor = await currentCursor(backend);
	for (let i = 0; i < WARMUP; i++) {
		await call(backend, options);
		const read = await awaitExecution(backend, options, cursor);
		if (read.execution?.kind !== 'executed') {
			throw new Error(`Warmup call ${i + 1} did not execute: ${read.execution?.kind ?? 'missing'}`);
		}
		cursor = read.cursor;
	}
	const start = oneMinuteLoad();
	const samples: CallSample[] = [];
	for (let i = 0; i < RUNS; i++) {
		const begin = performance.now();
		await call(backend, options);
		const roundTripMs = performance.now() - begin;
		const read = await awaitExecution(backend, options, cursor);
		cursor = read.cursor;
		samples.push({ roundTripMs, execution: read.execution });
	}
	const end = oneMinuteLoad();
	const late = await countLateCompletions(backend, options.identifier, cursor);
	return summarizeAttempt(samples, { start, end }, late);
}

async function run(root: string, options: RunOptions) {
	const backend = {
		url: readFileSync(path.join(root, '.convex', '.test-backend-url'), 'utf8').trim(),
		adminKey: readAdminKey(root, 'dev:test')
	};
	const attempts: Attempt[] = [];
	for (let i = 0; i < ATTEMPTS; i++) {
		const attempt = await measure(backend, options);
		attempts.push(attempt);
		if (attempt.counted) break;
	}
	const counted = attempts.find((attempt) => attempt.counted);
	return {
		identifier: options.identifier,
		kind: options.kind,
		identity: options.identity ?? null,
		runs: RUNS,
		warmup: WARMUP,
		backendUrl: backend.url,
		configuredBackendRevision: LOCAL_CONVEX_BINARY_VERSION,
		maxLoadAverage: MAX_LOAD_AVERAGE,
		cpus: os.cpus().length,
		status: counted ? 'counted' : 'unproven',
		result: counted ?? null,
		attempts
	};
}

if (import.meta.main) {
	const { values } = parseArgs({
		options: {
			function: { type: 'string' },
			kind: { type: 'string', default: 'mutation' },
			args: { type: 'string', default: '{}' },
			identity: { type: 'string' },
			out: { type: 'string' }
		}
	});
	const kind = v.parse(v.picklist(['query', 'mutation']), values.kind);
	if (!values.function) {
		throw new Error(
			'Usage: bun run measure:backend --function <module:name> [--kind mutation] [--identity <json>]'
		);
	}
	const report = await run(process.cwd(), {
		identifier: values.function,
		kind,
		args: JSON.parse(values.args),
		identity: values.identity
			? v.parse(actingIdentitySchema, JSON.parse(values.identity))
			: undefined
	});
	const text = JSON.stringify(report, null, 2);
	if (values.out) writeFileSync(values.out, `${text}\n`);
	console.log(text);
	if (report.status !== 'counted') process.exitCode = 1;
}
