// @vitest-environment node

import { inspect } from 'node:util';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

// Made-up values standing in for what a failed lookup can carry.
const MESSAGE_SENTINEL = 'private-invitee@sentinel.example';
const CAUSE_SENTINEL = 'cause-sentinel-91c2';

const runtime = vi.hoisted(() => ({
	dev: false,
	sentry: null as { captureException: (...args: unknown[]) => unknown } | null
}));

vi.mock('$app/env', () => ({
	get dev() {
		return runtime.dev;
	},
	browser: false,
	building: false,
	version: 'test'
}));
// The capture itself is the real SDK's, read from emitted events in
// src/lib/monitoring/sentry.test.ts. Here a stand-in records or fails it.
vi.mock('#lib/monitoring/sentry.js', () => ({ loadedSentry: () => runtime.sentry }));

const { reportRecoveredFailure } = await import('./recovered-failure');

const LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;
type Level = (typeof LEVELS)[number];
let consoles: Record<Level, MockInstance>;

function spyOnConsole(): Record<Level, MockInstance> {
	const silent = () => {};
	return {
		log: vi.spyOn(console, 'log').mockImplementation(silent),
		info: vi.spyOn(console, 'info').mockImplementation(silent),
		warn: vi.spyOn(console, 'warn').mockImplementation(silent),
		error: vi.spyOn(console, 'error').mockImplementation(silent),
		debug: vi.spyOn(console, 'debug').mockImplementation(silent)
	};
}

function lines(level?: Level): string[] {
	return LEVELS.filter((name) => level === undefined || name === level)
		.flatMap((name) => consoles[name].mock.calls)
		.map((args) =>
			args.map((arg) => (typeof arg === 'string' ? arg : inspect(arg, { depth: 5 }))).join(' ')
		);
}

function backendFailure() {
	return new Error(`Backend rejected ${MESSAGE_SENTINEL}`, {
		cause: new Error(`upstream echoed ${CAUSE_SENTINEL}`)
	});
}

function expectNoSentinel(output: string[]) {
	for (const sentinel of [MESSAGE_SENTINEL, CAUSE_SENTINEL]) {
		expect(output.join('\n')).not.toContain(sentinel);
	}
}

beforeEach(() => {
	runtime.dev = false;
	runtime.sentry = { captureException: vi.fn() };
	consoles = spyOnConsole();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('reportRecoveredFailure', () => {
	it('logs one safe line and hands the full error to Sentry', () => {
		const error = backendFailure();

		reportRecoveredFailure('[test] Lookup failed', error, { route: '/[[lang]]/app' });

		expect(lines()).toHaveLength(1);
		expect(lines('error')[0]).toMatch(
			/^\[test\] Lookup failed diagnostic=[0-9a-f]{16} route=\/\[\[lang\]\]\/app$/
		);
		expectNoSentinel(lines());
		expect(runtime.sentry?.captureException).toHaveBeenCalledWith(error, {
			mechanism: { type: 'recovered_failure', handled: true }
		});
	});

	it('logs only the line while Sentry is not loaded', () => {
		runtime.sentry = null;

		reportRecoveredFailure('[test] Lookup failed', backendFailure());

		expect(lines('error')).toHaveLength(1);
		expectNoSentinel(lines());
	});

	it.each([
		['a missing session', new ConvexError('Unauthenticated'), 'UNAUTHENTICATED'],
		['a missing document', new ConvexError({ code: 'NOT_FOUND' }), 'NOT_FOUND'],
		['a forbidden document', new ConvexError({ code: 'FORBIDDEN' }), 'FORBIDDEN']
	])('warns about %s with its code and keeps it out of Sentry', (_case, error, code) => {
		reportRecoveredFailure('[test] Lookup refused', error);

		expect(lines('error')).toEqual([]);
		expect(lines('warn')).toHaveLength(1);
		expect(lines('warn')[0]).toContain(` code=${code}`);
		expect(runtime.sentry?.captureException).not.toHaveBeenCalled();
	});

	it('reports a backend error that is no refusal', () => {
		reportRecoveredFailure('[test] Lookup failed', new ConvexError({ code: 'RATE_LIMITED' }));

		expect(lines('error')).toHaveLength(1);
		expect(runtime.sentry?.captureException).toHaveBeenCalledOnce();
	});

	it('prints the full error in dev', () => {
		runtime.dev = true;

		reportRecoveredFailure('[test] Lookup failed', backendFailure());

		const output = lines().join('\n');
		expect(output).toContain(MESSAGE_SENTINEL);
		expect(output).toContain(CAUSE_SENTINEL);
	});

	it('keeps the line when the capture throws', () => {
		runtime.sentry = {
			captureException: () => {
				throw new Error('transport down');
			}
		};

		expect(() => reportRecoveredFailure('[test] Lookup failed', backendFailure())).not.toThrow();
		expect(lines('error')).toHaveLength(1);
	});

	it('still captures when the console throws', () => {
		consoles.error.mockImplementation(() => {
			throw new Error('stdout closed');
		});
		const error = backendFailure();

		expect(() => reportRecoveredFailure('[test] Lookup failed', error)).not.toThrow();
		expect(runtime.sentry?.captureException).toHaveBeenCalledWith(error, expect.anything());
	});

	it('survives an error whose properties throw', () => {
		const hostile = new Proxy(
			{},
			{
				get() {
					throw new Error('getter exploded');
				},
				getPrototypeOf() {
					throw new Error('prototype exploded');
				}
			}
		);

		expect(() => reportRecoveredFailure('[test] Lookup failed', hostile)).not.toThrow();
		expect(lines('error')).toHaveLength(1);
		expect(runtime.sentry?.captureException).toHaveBeenCalledOnce();
	});
});
