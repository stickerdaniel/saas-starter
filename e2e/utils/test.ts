// The `test` every E2E spec and setup project imports; ESLint rejects the raw
// Playwright runner. A test attempt fails when a page it drives raises a client
// error the test did not allow: an uncaught exception (`pageerror`), or an
// error SvelteKit's client `handleError` reports through the
// `__e2eReportClientError` binding (src/lib/monitoring/e2e-client-error.ts).
//
// The `context` fixture is instrumented only when a test asks for it, so
// request-only tests still never launch a browser. A context the test builds
// itself with `browser.newContext()` goes through `guardClientErrors` before
// its first page.
//
// A test that provokes an error on purpose names it, with a reason:
//
//   // The offline banner is the behaviour under test.
//   test.use({ allowedClientErrors: [/Failed to fetch/] });
//
// e2e/public-client-error-guard.spec.ts proves each channel, the allowance and
// the browser-free request path.

import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

type ClientErrorFixtures = {
	/** Messages of client errors this test provokes on purpose. */
	allowedClientErrors: RegExp[];
	/** Messages collected during the current attempt, in arrival order. */
	clientErrors: string[];
};

// A worker runs one test at a time, so the running attempt's collector can sit
// in module state, where `guardClientErrors` reaches it without a fixture.
let activeCollector: string[] | null = null;

async function collectInto(context: BrowserContext, collector: string[]): Promise<void> {
	await context.exposeBinding('__e2eReportClientError', (_source, message: string) => {
		collector.push(message);
	});
	const listen = (page: Page) => page.on('pageerror', (error) => collector.push(error.message));
	context.pages().forEach(listen);
	context.on('page', listen);
}

/**
 * Feeds the client errors of a context the test created itself into the
 * running attempt's guard. Call it on the new context before its first page.
 */
export async function guardClientErrors(context: BrowserContext): Promise<BrowserContext> {
	if (!activeCollector) {
		throw new Error('guardClientErrors needs a running test; beforeAll and global setup have none');
	}
	await collectInto(context, activeCollector);
	return context;
}

export const test = base.extend<ClientErrorFixtures>({
	allowedClientErrors: [[], { option: true }],
	clientErrors: [
		async ({ allowedClientErrors }, use) => {
			const collector: string[] = [];
			activeCollector = collector;
			await use(collector);
			activeCollector = null;

			const unexpected = collector.filter(
				(message) => !allowedClientErrors.some((pattern) => pattern.test(message))
			);
			expect(
				unexpected,
				'Unexpected client errors. Fix them, or allow a deliberately provoked one with allowedClientErrors.'
			).toEqual([]);
		},
		{ auto: true }
	],
	// Depends on `clientErrors`, so Playwright tears the context down first and
	// errors raised while its pages close still reach the check above.
	context: async ({ context, clientErrors }, use) => {
		await collectInto(context, clientErrors);
		await use(context);
	}
});
