import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	countsUnderLoad,
	executionOf,
	parseLogPage,
	percentile,
	pinnedBackendRevision,
	summarizeAttempt,
	type CallSample
} from './backend-latency';

const IDENTIFIER = 'admin/customerNotifications/cancel:cancelUnsentEmails';

const completion = (overrides: Record<string, unknown> = {}) => ({
	kind: 'Completion',
	udfType: 'Mutation',
	componentPath: null,
	identifier: IDENTIFIER,
	logLines: [],
	timestamp: 1795401912.055977,
	cachedResult: false,
	caller: 'HttpApi',
	parentExecutionId: null,
	executionTime: 0.021833209,
	userExecutionTime: 0.021371333,
	success: null,
	error: null,
	requestId: '24a673555730acbc',
	executionId: '28f81430-c79c-4cc0-8fd5-2f746edfab51',
	returnBytes: 4,
	occInfo: null,
	willRetry: false,
	identityType: 'instance_admin',
	environment: 'isolate',
	...overrides
});

const executionIn = (...entries: unknown[]) =>
	executionOf(parseLogPage({ entries, newCursor: 1 }).entries, IDENTIFIER);

describe('percentile', () => {
	it('takes the median for p50, averaging the middle pair', () => {
		expect(percentile([5, 1, 3], 50)).toBe(3);
		expect(percentile([4, 1, 3, 2], 50)).toBe(2.5);
	});

	it('takes the nearest rank for p95', () => {
		const samples = Array.from({ length: 100 }, (_, i) => 100 - i);
		expect(percentile(samples, 95)).toBe(95);
		expect(percentile([1, 2, 3], 95)).toBe(3);
	});
});

describe('log stream', () => {
	it('reads userExecutionTime in milliseconds from an executed call', () => {
		expect(executionIn(completion())).toEqual({
			kind: 'executed',
			userExecutionMs: 21.371333
		});
	});

	it('leaves userExecutionMs unset when the entry lacks the field', () => {
		const { userExecutionTime: _, ...entry } = completion();
		expect(executionIn(entry)).toEqual({ kind: 'executed', userExecutionMs: undefined });
	});

	it('reports a cache hit as not executed', () => {
		expect(executionIn(completion({ cachedResult: true }))).toEqual({ kind: 'cached' });
	});

	it('reports a failed call with its error', () => {
		expect(executionIn(completion({ error: 'Server Error' }))).toEqual({
			kind: 'failed',
			error: 'Server Error'
		});
	});

	it('counts only the final attempt of an OCC retry', () => {
		const retried = completion({ willRetry: true, userExecutionTime: 0.5 });
		expect(executionIn(retried, completion())).toEqual({
			kind: 'executed',
			userExecutionMs: 21.371333
		});
	});

	it('does not count a completion without the retry flag', () => {
		expect(executionIn(completion({ willRetry: undefined }))).toBeUndefined();
	});

	it('ignores other functions and console entries', () => {
		const other = completion({ identifier: 'users:getProfile' });
		const consoleEntry = { kind: 'Console', identifier: IDENTIFIER, message: 'x' };
		expect(executionIn(other, consoleEntry)).toBeUndefined();
	});

	it('flags two completions for one call as ambiguous', () => {
		expect(executionIn(completion(), completion())).toEqual({ kind: 'ambiguous', completions: 2 });
	});

	it('rejects a page without a cursor', () => {
		expect(() => parseLogPage({ entries: [] })).toThrow();
	});
});

describe('load rule', () => {
	it('counts a run only when the load average is at most 8 at start and end', () => {
		expect(countsUnderLoad({ start: 8, end: 7.5 })).toBe(true);
		expect(countsUnderLoad({ start: 8.1, end: 2 })).toBe(false);
		expect(countsUnderLoad({ start: 2, end: 8.1 })).toBe(false);
	});
});

describe('attempt summary', () => {
	const executed = (roundTripMs: number, userExecutionMs: number | undefined): CallSample => ({
		roundTripMs,
		execution: { kind: 'executed', userExecutionMs }
	});
	const quiet = { start: 1, end: 1 };

	it('counts a quiet run where every call executed', () => {
		const attempt = summarizeAttempt([executed(10, 2), executed(20, 4), executed(30, 6)], quiet, 0);
		expect(attempt.counted).toBe(true);
		expect(attempt.roundTrip.p50Ms).toBe(20);
		expect(attempt.userExecution).toEqual({ proven: true, p50Ms: 4, p95Ms: 6 });
	});

	it('does not count a run above the load limit', () => {
		expect(summarizeAttempt([executed(10, 2)], { start: 30, end: 1 }, 0).counted).toBe(false);
	});

	it('does not count a run with a cached or unlogged call', () => {
		const attempt = summarizeAttempt(
			[
				executed(10, 2),
				{ roundTripMs: 1, execution: { kind: 'cached' } },
				{ roundTripMs: 1, execution: undefined }
			],
			quiet,
			0
		);
		expect(attempt.counted).toBe(false);
		expect(attempt.notExecuted).toMatchObject({ cached: 1, missing: 1 });
	});

	it('leaves the execution-time gate unproven when one call lacks the field', () => {
		const attempt = summarizeAttempt([executed(10, 2), executed(20, undefined)], quiet, 0);
		expect(attempt.userExecution).toEqual({ proven: false, callsWithoutField: 1 });
		expect(attempt.counted).toBe(false);
	});

	it('does not count a run when a completion arrives after the last call', () => {
		const attempt = summarizeAttempt([executed(10, 2), executed(20, 4)], quiet, 1);
		expect(attempt.counted).toBe(false);
		expect(attempt.lateCompletions).toBe(1);
	});
});

describe('backend revision', () => {
	it('reads the pinned binaryVersion from the Vite config', () => {
		expect(pinnedBackendRevision(readFileSync('vite.config.ts', 'utf8'))).toMatch(/^precompiled-/);
	});
});
