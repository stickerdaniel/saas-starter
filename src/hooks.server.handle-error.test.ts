// @vitest-environment node

import { inspect } from 'node:util';
import type { ErrorEvent } from '@sentry/sveltekit';
import type * as PublicEnv from '$app/env/public';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

// Made-up values standing in for what a failing request can carry: an address
// in the error message, a token in the path and another in the query.
const ERROR_SENTINEL = 'private-invitee@sentinel.example';
const PATH_SENTINEL = 'path-sentinel-7f3a';
const QUERY_SENTINEL = 'query-sentinel-91c2';

const runtime = vi.hoisted(() => ({ dev: false, loadSentry: vi.fn() }));

vi.mock('$app/env', () => ({
	get dev() {
		return runtime.dev;
	},
	building: false,
	browser: false,
	version: 'test'
}));
// A DSN keeps the hooks' dev notice about a missing one out of the console.
// Whether the SDK loads is up to `runtime.loadSentry`.
vi.mock('$app/env/public', async (importOriginal) => ({
	...(await importOriginal<typeof PublicEnv>()),
	PUBLIC_SENTRY_DSN: 'https://public@sentry.test/1'
}));
vi.mock('#lib/monitoring/sentry.js', () => ({
	loadSentry: runtime.loadSentry,
	loadSentryHandle: async () => null
}));

const LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;
let consoleSpies: MockInstance[] = [];

function consoleLines(): string[] {
	return consoleSpies
		.flatMap((spy) => spy.mock.calls)
		.map((args) =>
			args
				.map((arg) => (typeof arg === 'string' ? arg : inspect(arg, { depth: Infinity })))
				.join(' ')
		);
}

const SAFE_LINE =
	/^\[server\] Request failed diagnostic=[0-9a-f]{16} status=500 method=POST route=\/\[\[lang\]\]\/app\/\[id\]$/;

function failingEvent(routeId: string | null): RequestEvent {
	const url = new URL(
		`https://example.com/en/app/${PATH_SENTINEL}?token=${QUERY_SENTINEL}&email=${ERROR_SENTINEL}`
	);
	return {
		url,
		request: new Request(url, { method: 'POST' }),
		route: { id: routeId },
		params: {},
		locals: {}
	} as unknown as RequestEvent;
}

// The input shapes SvelteKit 3 hands the hook: a thrown error is `unknown`, a
// route it could not match is a `framework` error carrying its status.
function thrownError() {
	const error = new Error(`Backend rejected ${ERROR_SENTINEL}`, {
		cause: new Error(`upstream echoed ${QUERY_SENTINEL}`)
	});
	return { kind: 'unknown' as const, error, event: failingEvent('/[[lang]]/app/[id]') };
}

function notFound() {
	return {
		kind: 'framework' as const,
		error: { status: 404, message: `Not found: /en/app/${PATH_SENTINEL}` },
		event: failingEvent(null)
	};
}

async function loadHandleError() {
	vi.resetModules();
	return (await import('./hooks.server')).handleError;
}

function expectNoSentinel(lines: string[]) {
	for (const sentinel of [ERROR_SENTINEL, PATH_SENTINEL, QUERY_SENTINEL]) {
		expect(lines.join('\n')).not.toContain(sentinel);
	}
}

beforeEach(() => {
	consoleSpies = LEVELS.map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
	runtime.dev = false;
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('handleError without Sentry', () => {
	beforeEach(() => {
		runtime.loadSentry.mockReset().mockResolvedValue(null);
	});

	it('logs a thrown error as one safe line', async () => {
		const handleError = await loadHandleError();

		const result = await handleError(thrownError());

		// SvelteKit renders its default body when the hook returns nothing.
		expect(result).toBeUndefined();
		const lines = consoleLines();
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatch(SAFE_LINE);
		expectNoSentinel(lines);
	});

	it('logs rejected remote function input without the issues', async () => {
		const handleError = await loadHandleError();

		await handleError({
			kind: 'validation',
			error: { status: 400, message: 'Bad Request' },
			issues: [{ message: `Invalid email ${ERROR_SENTINEL}` }],
			event: failingEvent('/[[lang]]/app/[id]')
		});

		const lines = consoleLines();
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain('status=400');
		expectNoSentinel(lines);
	});

	it('stays silent for errors a route or SvelteKit chose', async () => {
		const handleError = await loadHandleError();

		await handleError(notFound());
		await handleError({
			kind: 'app',
			error: { status: 403, message: 'Forbidden' },
			event: failingEvent('/[[lang]]/app/[id]')
		});

		expect(consoleLines()).toEqual([]);
	});

	it('prints the full error in dev', async () => {
		runtime.dev = true;
		const handleError = await loadHandleError();

		await handleError(thrownError());

		const output = consoleLines().join('\n');
		expect(output).toContain(`Backend rejected ${ERROR_SENTINEL}`);
		expect(output).toContain(`upstream echoed ${QUERY_SENTINEL}`);
	});
});

describe('handleError with Sentry', () => {
	const events: ErrorEvent[] = [];

	beforeEach(async () => {
		events.length = 0;
		// The real SDK, so its own handler decides what reaches the console.
		// Events stop at beforeSend and never leave the process. The runtime module
		// hooks would outlive close() in a reused worker, and nothing here needs them.
		const sentry = await import('@sentry/sveltekit');
		sentry.init({
			dsn: 'https://public@sentry.test/1',
			defaultIntegrations: false,
			enableOpenTelemetrySetup: false,
			enableRuntimeChannelInjection: false,
			beforeSend: (event) => {
				events.push(event);
				return null;
			}
		});
		runtime.loadSentry.mockReset().mockResolvedValue(sentry);
	});

	afterEach(async () => {
		await (await import('@sentry/sveltekit')).close();
	});

	// This SDK has no projection: its beforeSend stands in for the one in
	// src/lib/monitoring/sentry.ts, so the event still holds the raw error.
	it('logs the safe line, then reports the error once under the same diagnostic id', async () => {
		const handleError = await loadHandleError();

		const result = await handleError(thrownError());
		await (await import('@sentry/sveltekit')).flush();

		expect(result).toBeUndefined();
		expect(events.map((event) => event.exception?.values?.at(-1)?.value)).toEqual([
			`Backend rejected ${ERROR_SENTINEL}`
		]);
		const lines = consoleLines();
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatch(SAFE_LINE);
		expectNoSentinel(lines);
		expect(events[0]?.contexts?.correlation).toEqual({
			diagnosticId: lines[0]?.match(/ diagnostic=([0-9a-f]{16}) /)?.[1]
		});
	});

	it('still reports the error when the console throws', async () => {
		for (const spy of consoleSpies) {
			spy.mockImplementation(() => {
				throw new Error('stdout closed');
			});
		}
		const handleError = await loadHandleError();

		await handleError(thrownError());
		await (await import('@sentry/sveltekit')).flush();

		expect(events).toHaveLength(1);
		expect(events[0]?.contexts).not.toHaveProperty('correlation');
	});

	it('neither reports nor logs a 404', async () => {
		const handleError = await loadHandleError();

		await handleError(notFound());
		await (await import('@sentry/sveltekit')).flush();

		expect(events).toEqual([]);
		expect(consoleLines()).toEqual([]);
	});
});
