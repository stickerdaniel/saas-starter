import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import * as v from 'valibot';
import { readAdminKey } from './confect-dev';
import { required } from './required';

export const MAX_LOAD_AVERAGE = 8;
const REQUEST_DEADLINE_MS = 10_000;

const oneMinuteLoad = () => required(os.loadavg()[0], 'load average');

export type FunctionKind = 'query' | 'mutation';

const logEntrySchema = v.looseObject({
	kind: v.string(),
	identifier: v.optional(v.string()),
	cachedResult: v.optional(v.boolean()),
	userExecutionTime: v.optional(v.nullable(v.number())),
	willRetry: v.optional(v.nullable(v.boolean())),
	error: v.optional(v.nullable(v.string()))
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
	| { kind: 'ambiguous'; completions: number };

export function executionOf(
	entries: readonly LogEntry[],
	identifier: string
): Execution | undefined {
	const completions = entries.filter(
		(entry) =>
			entry.kind === 'Completion' && entry.identifier === identifier && entry.willRetry !== true
	);
	const [completion] = completions;
	if (completion === undefined) return undefined;
	if (completions.length > 1) return { kind: 'ambiguous', completions: completions.length };
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
	notExecuted: { cached: number; failed: number; missing: number; ambiguous: number };
	userExecution:
		{ proven: true; p50Ms: number; p95Ms: number } | { proven: false; callsWithoutField: number };
};

const round = (value: number) => Number(value.toFixed(3));

export function summarizeAttempt(samples: readonly CallSample[], load: LoadReading): Attempt {
	const roundTrips = samples.map((sample) => sample.roundTripMs);
	const notExecuted = { cached: 0, failed: 0, missing: 0, ambiguous: 0 };
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
		counted: allExecuted && countsUnderLoad(load),
		roundTrip: {
			p50Ms: round(percentile(roundTrips, 50)),
			p95Ms: round(percentile(roundTrips, 95)),
			minMs: round(Math.min(...roundTrips)),
			maxMs: round(Math.max(...roundTrips))
		},
		executed,
		notExecuted,
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

async function call(backend: Backend, kind: FunctionKind, identifier: string, args: unknown) {
	const response = await fetch(`${backend.url}/api/${kind}`, {
		method: 'POST',
		headers: { Authorization: `Convex ${backend.adminKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ path: identifier, args, format: 'json' }),
		signal: AbortSignal.timeout(REQUEST_DEADLINE_MS)
	});
	const body: unknown = await response.json();
	if (!response.ok || !v.is(v.object({ status: v.literal('success') }), body)) {
		throw new Error(`${identifier} failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
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

async function awaitExecution(backend: Backend, identifier: string, cursor: number) {
	const signal = AbortSignal.timeout(REQUEST_DEADLINE_MS);
	const seen: LogEntry[] = [];
	let next = cursor;
	while (true) {
		let page: LogPage;
		try {
			page = await readLogs(backend, next, signal);
		} catch (error) {
			if (signal.aborted) return { execution: executionOf(seen, identifier), cursor: next };
			throw error;
		}
		seen.push(...page.entries);
		next = page.newCursor;
		const execution = executionOf(seen, identifier);
		if (execution !== undefined) return { execution, cursor: next };
	}
}

export type RunOptions = {
	identifier: string;
	kind: FunctionKind;
	args: unknown;
	runs: number;
	warmup: number;
	attempts: number;
};

async function measure(backend: Backend, options: RunOptions): Promise<Attempt> {
	let cursor = await currentCursor(backend);
	for (let i = 0; i < options.warmup; i++) {
		await call(backend, options.kind, options.identifier, options.args);
		cursor = (await awaitExecution(backend, options.identifier, cursor)).cursor;
	}
	const start = oneMinuteLoad();
	const samples: CallSample[] = [];
	for (let i = 0; i < options.runs; i++) {
		const begin = performance.now();
		await call(backend, options.kind, options.identifier, options.args);
		const roundTripMs = performance.now() - begin;
		const read = await awaitExecution(backend, options.identifier, cursor);
		cursor = read.cursor;
		samples.push({ roundTripMs, execution: read.execution });
	}
	return summarizeAttempt(samples, { start, end: oneMinuteLoad() });
}

export function pinnedBackendRevision(viteConfig: string): string | undefined {
	return /binaryVersion:\s*'([^']+)'/.exec(viteConfig)?.[1];
}

async function run(root: string, options: RunOptions) {
	const backend = {
		url: readFileSync(path.join(root, '.convex', '.test-backend-url'), 'utf8').trim(),
		adminKey: readAdminKey(root, 'dev:test')
	};
	const attempts: Attempt[] = [];
	for (let i = 0; i < options.attempts; i++) {
		const attempt = await measure(backend, options);
		attempts.push(attempt);
		if (attempt.counted) break;
	}
	const counted = attempts.find((attempt) => attempt.counted);
	return {
		identifier: options.identifier,
		kind: options.kind,
		runs: options.runs,
		backendUrl: backend.url,
		backendRevision: pinnedBackendRevision(readFileSync(path.join(root, 'vite.config.ts'), 'utf8')),
		maxLoadAverage: MAX_LOAD_AVERAGE,
		cpus: os.cpus().length,
		status: counted ? 'counted' : 'unproven',
		result: counted ?? null,
		attempts
	};
}

const countSchema = (min: number) => v.pipe(v.number(), v.integer(), v.minValue(min));

if (import.meta.main) {
	const { values } = parseArgs({
		options: {
			function: { type: 'string' },
			kind: { type: 'string', default: 'mutation' },
			args: { type: 'string', default: '{}' },
			runs: { type: 'string', default: '100' },
			warmup: { type: 'string', default: '10' },
			attempts: { type: 'string', default: '3' },
			out: { type: 'string' }
		}
	});
	const kind = v.parse(v.picklist(['query', 'mutation']), values.kind);
	const count = (value: string, min: number) => v.parse(countSchema(min), Number(value));
	if (!values.function) {
		throw new Error('Usage: bun run measure:backend --function <module:name> [--kind mutation]');
	}
	const report = await run(process.cwd(), {
		identifier: values.function,
		kind,
		args: JSON.parse(values.args),
		runs: count(values.runs, 1),
		warmup: count(values.warmup, 0),
		attempts: count(values.attempts, 1)
	});
	const text = JSON.stringify(report, null, 2);
	if (values.out) writeFileSync(values.out, `${text}\n`);
	console.log(text);
	if (report.status !== 'counted') process.exitCode = 1;
}
