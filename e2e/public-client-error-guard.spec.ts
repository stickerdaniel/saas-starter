import { expect, type Page } from '@playwright/test';
import { guardClientErrors, test } from './utils/test';

// Cheaper layers rejected because: the guard is a Playwright fixture, and only
// the runner shows that its teardown fails a test whose body passed. The page
// is static, so no case waits on the deployment.
//
// The guard in e2e/utils/test.ts fails a test at teardown, after its body has
// passed. Each enforcing case therefore first proves its channel reached the
// collector, and only then, as its last statement, declares that the test must
// fail. A broken channel fails the body before that declaration; a missing
// teardown check leaves the declared failure unmet. Both turn the case red.

const MARKER = 'client-error-guard marker';
const DECLARED_FAILURE = 'teardown must reject the unallowed marker';

type GuardedWindow = Window & { __e2eReportClientError: (message: string) => Promise<void> };

async function staticPage(page: Page): Promise<void> {
	await page.setContent('<main>static</main>');
}

async function throwUncaught(page: Page, message: string): Promise<void> {
	const thrown = page.waitForEvent('pageerror');
	await page.evaluate((text) => {
		setTimeout(() => {
			throw new Error(text);
		});
	}, message);
	await thrown;
}

async function reportThroughBinding(page: Page, message: string): Promise<void> {
	await page.evaluate(
		(text) => (window as unknown as GuardedWindow).__e2eReportClientError(text),
		message
	);
}

test('an uncaught page error fails the test', async ({ page, clientErrors }) => {
	await staticPage(page);
	await throwUncaught(page, MARKER);
	expect(clientErrors).toEqual([MARKER]);
	test.fail(true, DECLARED_FAILURE);
});

test('an error reported by the client hook fails the test', async ({ page, clientErrors }) => {
	await staticPage(page);
	await reportThroughBinding(page, MARKER);
	expect(clientErrors).toEqual([MARKER]);
	test.fail(true, DECLARED_FAILURE);
});

test('a context the test builds itself feeds the same guard', async ({ browser, clientErrors }) => {
	const context = await guardClientErrors(
		await browser.newContext({ storageState: { cookies: [], origins: [] } })
	);
	try {
		const page = await context.newPage();
		await staticPage(page);
		await throwUncaught(page, `thrown ${MARKER}`);
		await reportThroughBinding(page, `reported ${MARKER}`);
	} finally {
		await context.close();
	}
	expect(clientErrors).toEqual([`thrown ${MARKER}`, `reported ${MARKER}`]);
	test.fail(true, DECLARED_FAILURE);
});

test.describe('an allowed error', () => {
	test.use({ allowedClientErrors: [/client-error-guard marker/] });

	test('passes', async ({ page, clientErrors }) => {
		await staticPage(page);
		await throwUncaught(page, MARKER);
		await reportThroughBinding(page, MARKER);
		expect(clientErrors).toEqual([MARKER, MARKER]);
	});
});

// The guard must not pull a browser into tests that only use `request`.
const withoutBrowser = test.extend({
	browser: [
		async ({ browserName }, _use) => {
			throw new Error(`a request-only test resolved the ${browserName} browser fixture`);
		},
		{ scope: 'worker' }
	]
});

withoutBrowser('a request-only test starts no browser', async ({ request, clientErrors }) => {
	expect(request).toBeDefined();
	expect(clientErrors).toEqual([]);
});
