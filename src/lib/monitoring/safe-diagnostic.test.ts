import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { logSafeDiagnostic } from './safe-diagnostic.js';

describe('logSafeDiagnostic', () => {
	let spies: Record<'error' | 'warn', MockInstance>;

	beforeEach(() => {
		spies = {
			error: vi.spyOn(console, 'error').mockImplementation(() => {}),
			warn: vi.spyOn(console, 'warn').mockImplementation(() => {})
		};
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function lastLine(level: 'error' | 'warn' = 'error'): string {
		const calls = spies[level].mock.calls;
		expect(calls.at(-1)).toHaveLength(1);
		return String(calls.at(-1)?.[0]);
	}

	it('writes one line with a fresh id per occurrence', () => {
		logSafeDiagnostic('warn', '[test] Failed', { operation: 'state' });
		const first = lastLine('warn');
		logSafeDiagnostic('warn', '[test] Failed', { operation: 'state' });
		const second = lastLine('warn');

		expect(first).toMatch(/^\[test\] Failed diagnostic=[0-9a-f]{16} operation=state$/);
		expect(first.match(/diagnostic=(\w+)/)?.[1]).not.toBe(second.match(/diagnostic=(\w+)/)?.[1]);
	});

	it('writes the fields in a fixed order', () => {
		logSafeDiagnostic('error', '[test] Failed', {
			route: '/api/auth/[...all]',
			method: 'POST',
			code: 'http',
			status: 502,
			operation: 'proxy'
		});

		expect(lastLine()).toMatch(
			/ operation=proxy status=502 code=http method=POST route=\/api\/auth\/\[\.\.\.all\]$/
		);
	});

	it('drops a status that is not an HTTP status code', () => {
		for (const status of [0, 99, 600, 404.5, Number.NaN]) {
			logSafeDiagnostic('error', '[test] Failed', { status });
			expect(lastLine()).not.toContain('status=');
		}
	});

	it('writes a nonstandard method as OTHER', () => {
		logSafeDiagnostic('error', '[test] Failed', { method: 'X-PRIVATE-METHOD' });

		expect(lastLine()).toMatch(/ method=OTHER$/);
	});

	it('names an unmatched route', () => {
		logSafeDiagnostic('error', '[test] Failed', { route: null });

		expect(lastLine()).toMatch(/ route=unmatched$/);
	});

	it('keeps a value that is not a single token from adding fields or lines', () => {
		logSafeDiagnostic('error', '[test] Failed', {
			code: 'http status=200\nforged line',
			route: `/${'a'.repeat(200)}`
		});

		expect(lastLine()).toMatch(/ code=invalid route=invalid$/);
	});
});
