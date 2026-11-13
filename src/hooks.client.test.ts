import { beforeEach, describe, expect, it, vi } from 'vitest';

type Input = { kind: string; error: unknown };
type Sentry = { handleErrorWithSentry: (handler: (input: Input) => unknown) => unknown };

const sentry = vi.hoisted(() => ({
	settle: (_value: unknown) => {},
	promise: null as Promise<unknown> | null
}));

vi.mock('$app/env', () => ({ dev: false, browser: true }));
vi.mock('#lib/monitoring/sentry.js', () => ({ loadSentry: () => sentry.promise }));

// The SDK 11.10.0 client wrapper captures, then always calls the handler it
// wraps. Only the call matters here, so the capture is left out.
const loadedSentry: Sentry = {
	handleErrorWithSentry: (handler) => (input: Input) => handler(input)
};

async function loadHook() {
	vi.resetModules();
	sentry.promise = new Promise((resolve) => (sentry.settle = resolve));
	const { handleError } = await import('./hooks.client');
	return (input: Input) => handleError(input as never);
}

async function resolveSentry(value: Sentry): Promise<void> {
	sentry.settle(value);
	// A macrotask lets the hook's promise chain finish after the import settles.
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('client handleError', () => {
	// Stands in for the binding Playwright exposes in a driven browser context.
	const e2eReporter = vi.fn<(message: string) => void>();

	beforeEach(() => {
		e2eReporter.mockClear();
		window.__e2eReportClientError = e2eReporter;
		return () => {
			delete window.__e2eReportClientError;
		};
	});

	it('hands a reported error to the E2E guard by its message before Sentry loads', async () => {
		const handleError = await loadHook();

		handleError({ kind: 'unknown', error: new Error('effect_update_depth_exceeded') });
		handleError({ kind: 'framework', error: { status: 500, message: 'Internal Error' } });

		expect(e2eReporter.mock.calls).toEqual([['effect_update_depth_exceeded'], ['Internal Error']]);
	});

	it('hands a reported error to the E2E guard once Sentry has loaded', async () => {
		const handleError = await loadHook();
		await resolveSentry(loadedSentry);

		handleError({ kind: 'unknown', error: new Error('after load') });

		expect(e2eReporter.mock.calls).toEqual([['after load']]);
	});

	it.each([
		['an app 404', { kind: 'app', error: { status: 404, message: 'Not Found' } }],
		['an app 500', { kind: 'app', error: { status: 500, message: 'Chosen failure' } }],
		['a framework 404', { kind: 'framework', error: { status: 404, message: 'Not Found' } }]
	])('never hands %s to the E2E guard, loaded or not', async (_label, input) => {
		const handleError = await loadHook();
		handleError(input);
		await resolveSentry(loadedSentry);
		handleError(input);

		expect(e2eReporter).not.toHaveBeenCalled();
	});
});
